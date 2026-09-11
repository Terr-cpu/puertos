// ══════════════════════════════════════════════════════════════
//  notificar-telegram — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Se dispara mediante Database Webhooks de Supabase en cada INSERT sobre
//  las tablas "bajas" y "refuerzos". Manda un aviso a Telegram directamente
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

  const { type, table, record } = payload || {};
  if (type !== 'INSERT' || !record) return new Response('ignorado (no es INSERT)');

  try {
    if (table === 'bajas') {
      // Solo avisar de bajas activas (una desactivación/neutralización no es un aviso nuevo)
      if (record.activa === false) return new Response('ignorado (baja no activa)');
      const nombre = await nombreVoluntario(record.voluntario_id);
      const fecha = isoADMY(record.fecha);
      await enviarTelegram(
        `📤 <b>Baja comunicada</b>\n${nombre} no puede asistir — ${record.rango || 'turno'} del ${fecha}\n<i>${horaES()}</i>`
      );
    } else if (table === 'refuerzos') {
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
