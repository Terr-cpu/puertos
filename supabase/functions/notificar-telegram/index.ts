// ══════════════════════════════════════════════════════════════
//  notificar-telegram — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Se dispara mediante Database Webhooks de Supabase:
//   - INSERT (y UPDATE que reactiva una baja) en "bajas"  → baja comunicada
//   - INSERT en "refuerzos"                               → nuevo apunte
//   - INSERT en "actividad" (supabase/01_actividad.sql)   → apunte cancelado / baja anulada
//  Manda un aviso a Telegram directamente
//  desde el servidor, así que llega aunque el planificador esté cerrado en
//  el móvil (a diferencia del sondeo desde el navegador, que solo funciona
//  con la app abierta).
//
//  Despliegue y configuración: ver NOTIFICACIONES.md en la raíz del repo.
//
//  Variables de entorno que usa:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → inyectadas automáticamente
//     por Supabase en todas las Edge Functions, no hace falta configurarlas.
//   - TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID     → hay que darlas de alta como
//     "secrets" de la función (Supabase → Edge Functions → Secrets).
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT  = Deno.env.get('TELEGRAM_CHAT_ID');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

function isoADMY(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function horaES(): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
}

async function nombreVoluntario(id: string | number | null): Promise<string> {
  if (!id) return '(voluntario)';
  const { data, error } = await sb.from('voluntarios').select('nombre').eq('id', id).limit(1);
  if (error || !data?.length) return '(voluntario)';
  return data[0].nombre;
}

async function enviarTelegram(texto: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    console.warn('Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — no se envía nada');
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: texto, parse_mode: 'HTML' }),
  });
  if (!r.ok) console.error('Error Telegram:', r.status, await r.text());
}

Deno.serve(async (req) => {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response('sin body', { status: 400 });
  }

  const { type, table, record, old_record } = payload || {};
  if (!record || (type !== 'INSERT' && type !== 'UPDATE')) return new Response('ignorado (ni INSERT ni UPDATE)');

  try {
    if (table === 'actividad') {
      // Registro de auditoría (supabase/01_actividad.sql). Solo se avisa de lo que
      // no genera ya su propio aviso: apuntes cancelados y bajas anuladas.
      if (type !== 'INSERT') return new Response('ignorado');
      const fecha = isoADMY(record.fecha);
      const rango = record.rango || 'turno';
      const nombre = record.nombre || '(voluntario)';
      if (record.tipo === 'apunte_cancelado') {
        await enviarTelegram(`❌ <b>Apunte cancelado</b>\n${nombre} ya no cubre — ${rango} del ${fecha}\n<i>${horaES()}</i>`);
      } else if (record.tipo === 'baja_anulada') {
        // Si la anulación va acompañada de un apunte de la misma persona es una
        // reincorporación y ya avisó el apunte: se espera un instante y se comprueba.
        await new Promise((r) => setTimeout(r, 2500));
        const { data } = await sb.from('refuerzos').select('id')
          .eq('voluntario_id', record.voluntario_id).eq('fecha', record.fecha).eq('rango', record.rango ?? '').limit(1);
        if (data?.length) return new Response('ignorado (reincorporación ya avisada)');
        await enviarTelegram(`↩️ <b>Baja anulada</b>\n${nombre} vuelve a asistir — ${rango} del ${fecha}\n<i>${horaES()}</i>`);
      } else {
        return new Response('ignorado (tipo sin aviso)');
      }
      return new Response('ok');
    }

    if (table === 'bajas') {
      // Solo avisar de bajas activas (una desactivación/neutralización no es un aviso nuevo).
      // También cuenta el UPDATE que reactiva una baja anulada (registrarBaja hace upsert).
      if (record.activa === false) return new Response('ignorado (baja no activa)');
      if (type === 'UPDATE' && old_record?.activa !== false) return new Response('ignorado (update sin reactivación)');
      const nombre = await nombreVoluntario(record.voluntario_id);
      const fecha = isoADMY(record.fecha);
      await enviarTelegram(
        `📤 <b>Baja comunicada</b>\n${nombre} no puede asistir — ${record.rango || 'turno'} del ${fecha}\n<i>${horaES()}</i>`
      );
    } else if (table === 'refuerzos') {
      if (type !== 'INSERT') return new Response('ignorado');
      const nombre = await nombreVoluntario(record.voluntario_id);
      const fecha = isoADMY(record.fecha);
      const esDiaCompleto = !!record.es_dia_completo;
      const rangoTxt = (esDiaCompleto || !record.rango) ? 'disponible todo el día' : `turno ${record.rango}`;
      const emoji = esDiaCompleto ? '📅' : '✋';
      await enviarTelegram(
        `${emoji} <b>Nuevo apunte</b>\n${nombre} se ha apuntado — ${rangoTxt} del ${fecha}\n<i>${horaES()}</i>`
      );
    } else {
      return new Response('ignorado (tabla no reconocida)');
    }
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error: ' + (e as Error).message, { status: 500 });
  }
});
