// ══════════════════════════════════════════════════════════════
//  recordatorios-turnos — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Lo lanza una tarea programada (pg_cron, ver supabase/12_notificar_email.sql)
//  una vez al día. Mira los turnos de MAÑANA en "historial" agrupados por
//  voluntario y manda un recordatorio por correo a quien tenga email
//  guardado — con una nota de "lleva la llave" si es portador.
//  No duplica: usa "recordatorios_enviados" para no volver a mandar el mismo
//  día si la tarea se reintenta.
//
//  Secrets (Edge Functions → Secrets):
//   - RESEND_API_KEY, RESEND_FROM   (los mismos que notificar-email)
//   - CRON_SECRET     texto cualquiera; el mismo que se pone en 12_notificar_email.sql
//  Esta función se despliega con "Verify JWT" DESACTIVADO (la protege CRON_SECRET).
//  Un solo archivo a propósito: se pega tal cual en el editor del panel de Supabase.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM   = Deno.env.get('RESEND_FROM');
const CRON_SECRET   = Deno.env.get('CRON_SECRET');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/** "Hora de pared" de Madrid como milisegundos (fecha y hora locales tratadas como UTC). Igual que avisos-turnos. */
function paredMadrid(d: Date = new Date()): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
}
function isoDeMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function isoADMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Agrupa turnos de "mañana" por voluntario. Lógica pura, sin red — se prueba en test/. */
function agruparPorVoluntario(hist: { voluntario_id: string; rango: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  hist.forEach((h) => {
    if (!h.voluntario_id) return;
    if (!m.has(h.voluntario_id)) m.set(h.voluntario_id, []);
    m.get(h.voluntario_id)!.push(h.rango);
  });
  return m;
}

async function enviarCorreo(destinatario: string, asunto: string, html: string): Promise<void> {
  if (!RESEND_KEY || !RESEND_FROM) {
    console.warn('Faltan RESEND_API_KEY / RESEND_FROM — no se envía nada');
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [destinatario], subject: asunto, html }),
  });
  if (!r.ok) console.error('Error Resend:', r.status, await r.text());
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('no autorizado', { status: 401 });

  const ahoraMs = paredMadrid();
  const manana = isoDeMs(ahoraMs + 24 * 60 * 60 * 1000);

  try {
    const [{ data: hist }, { data: vols }] = await Promise.all([
      sb.from('historial').select('voluntario_id,rango').eq('fecha', manana),
      sb.from('voluntarios').select('id,nombre,email,tiene_llave'),
    ]);
    const porVol = agruparPorVoluntario(hist || []);
    const volPorId = new Map((vols || []).map((v: any) => [v.id, v]));

    let enviados = 0;
    for (const [volId, rangos] of porVol) {
      const v = volPorId.get(volId);
      if (!v?.email) continue;
      const clave = `${volId}|${manana}`;
      const { data: ya } = await sb.from('recordatorios_enviados').select('clave').eq('clave', clave).limit(1);
      if (ya?.length) continue;

      const lista = rangos.map((r) => `<li>${r}</li>`).join('');
      const llaveTxt = v.tiene_llave ? '<p>🔑 Eres portador de llave — no olvides llevarla.</p>' : '';
      const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1c2b3a">
        <h2 style="color:#0f1f38;margin-bottom:.5rem">Recordatorio de turno</h2>
        <p>Hola ${v.nombre}, mañana (${isoADMY(manana)}) tienes turno:</p>
        <ul>${lista}</ul>
        ${llaveTxt}
        <p style="font-size:.78rem;color:#5c7a96;margin-top:2rem">Puerto de Sevilla — Turnos</p>
      </div>`;
      await enviarCorreo(v.email, `Recordatorio: turno mañana ${isoADMY(manana)}`, html);
      await sb.from('recordatorios_enviados').insert({ clave });
      enviados++;
    }
    return new Response(JSON.stringify({ ok: true, manana, enviados }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response('error: ' + (e as Error).message, { status: 500 });
  }
});
