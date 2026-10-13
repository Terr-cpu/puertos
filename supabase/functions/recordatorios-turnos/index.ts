// ══════════════════════════════════════════════════════════════
//  recordatorios-turnos — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Lo lanza una tarea programada (pg_cron, ver supabase/12_notificar_email.sql)
//  una vez al día. Mira los turnos de MAÑANA en "historial" agrupados por
//  voluntario y manda un recordatorio por correo a quien tenga email
//  guardado — con una nota de "lleva la llave" si es portador.
//  No duplica: usa "recordatorios_enviados" para no volver a mandar el mismo
//  día si la tarea se reintenta.
//  Cada franja lleva la lista de compañeros del turno (🔑 = tiene llave).
//  Quién va de verdad se cuenta igual que en la app y en avisos-turnos:
//  equipo confirmado − bajas activas + apuntados; los turnos anulados a mano
//  no generan recordatorio. Así, quien ha dado de baja no recibe recordatorio
//  ni sale como compañero, y quien se ha apuntado sí.
//
//  Envío manual desde el planificador (En vivo → 📧 Enviar recordatorio), mismo
//  x-cron-secret (el coordinador lo guarda en 🔔 → Correo): body
//  { "turno": { "fecha": "2026-10-23", "rango": "16:00 a 18:00" } } → manda el
//  recordatorio a todos los que van a ese turno. Si el turno es mañana, lo anota
//  en recordatorios_enviados para que el automático de la noche no lo repita.
//
//  Modo prueba (mismo x-cron-secret): body { "prueba_voluntario_id": "<id>" }
//  → manda a ese voluntario el recordatorio de su PRÓXIMO turno (desde mañana),
//  con "[PRUEBA]" en el asunto, sin anotarlo en recordatorios_enviados.
//
//  Secrets (Edge Functions → Secrets):
//   - RESEND_API_KEY, RESEND_FROM   (los mismos que notificar-email)
//   - CUESTIONARIO_URL (opcional) enlace al cuestionario de fin de turno; por defecto el de Google Forms
//   - CRON_SECRET_RECORDATORIOS     texto cualquiera; el mismo que se pone en 12_notificar_email.sql
//     (nombre propio, distinto de CRON_SECRET, porque los secrets son por proyecto, no por
//     función — CRON_SECRET ya lo usa avisos-turnos y no hay que tocarlo)
//  Esta función se despliega con "Verify JWT" DESACTIVADO (la protege CRON_SECRET).
//  Un solo archivo a propósito: se pega tal cual en el editor del panel de Supabase.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM   = Deno.env.get('RESEND_FROM');
const CRON_SECRET   = Deno.env.get('CRON_SECRET_RECORDATORIOS');

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

type Fila = { voluntario_id: string; rango: string };

/**
 * Quién va a cada franja de un día: equipo − bajas activas + apuntados (baja + apunte
 * de la misma persona = se reincorpora), sin los turnos anulados. Mismo criterio que
 * la pestaña "En vivo" del planificador y que avisos-turnos. Lógica pura.
 */
function presentesDelDia(
  hist: Fila[], bajas: (Fila & { activa?: boolean })[],
  refs: (Fila & { es_dia_completo?: boolean })[], anulados: { rango: string }[],
): Fila[] {
  const fuera = new Set((anulados || []).map((a) => a.rango));
  const clave = (f: Fila) => f.voluntario_id + '|' + f.rango;
  const conBaja = new Set((bajas || []).filter((b) => b.activa && b.rango).map(clave));
  const apuntes = (refs || []).filter((r) => r.rango && !r.es_dia_completo && r.voluntario_id);
  const apuntado = new Set(apuntes.map(clave));
  const res: Fila[] = [];
  const ya = new Set<string>();
  const meter = (f: Fila) => {
    if (fuera.has(f.rango) || ya.has(clave(f))) return;
    ya.add(clave(f));
    res.push({ voluntario_id: f.voluntario_id, rango: f.rango });
  };
  for (const h of hist || []) if (h.voluntario_id && (!conBaja.has(clave(h)) || apuntado.has(clave(h)))) meter(h);
  for (const a of apuntes) meter(a);
  return res;
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

type Vol = { id: string; nombre: string; email?: string | null; tiene_llave?: boolean };

/** Compañeros de una franja (todos los de ese rango menos el propio voluntario), 🔑 si tienen llave. Lógica pura. */
function companeros(hist: { voluntario_id: string; rango: string }[], rango: string, yoId: string, volPorId: Map<string, Vol>): string[] {
  return hist
    .filter((h) => h.rango === rango && h.voluntario_id && h.voluntario_id !== yoId)
    .map((h) => volPorId.get(h.voluntario_id))
    .filter((v): v is Vol => !!v)
    .map((v) => v.nombre + (v.tiene_llave ? ' 🔑' : ''));
}

/** HTML del recordatorio: una tarjeta por franja con sus compañeros. "cuando" es "mañana (26/09/2026)" o "el 23/10/2026". */
function construirRecordatorio(v: Vol, cuando: string, fechaIso: string, rangos: string[], hist: { voluntario_id: string; rango: string }[], volPorId: Map<string, Vol>): string {
  let hayLlave = false;
  const tarjetas = rangos.map((r) => {
    const comp = companeros(hist, r, v.id, volPorId);
    if (comp.some((c) => c.endsWith('🔑'))) hayLlave = true;
    const equipo = `<div style="margin-top:8px;font-size:13px;color:#48484a"><b>Compañeros:</b> ${comp.length ? comp.join(', ') : 'de momento, ninguno más'}</div>`;
    return tarjetaTurno(fechaLarga(fechaIso), r, '#0071e3', '#ddeeff', equipo);
  }).join('');
  const llaveTxt = v.tiene_llave ? aviso('🔑', 'Eres portador de llave — no olvides llevarla.') : '';
  const leyenda = hayLlave ? '<p style="margin:0 0 14px;font-size:12px;color:#8e8e93">🔑 = tiene llave</p>' : '';
  return envoltorio('⏰', 'Recordatorio de turno', `
        <p style="margin:0">Hola <b>${v.nombre}</b>, ${cuando} tienes turno:</p>
        ${tarjetas}
        ${llaveTxt}
        ${leyenda}
        ${bloqueCuestionario()}`);
}

/** Versión en texto plano a partir del HTML del correo (los correos solo-HTML puntúan peor en los filtros de spam). */
function htmlATexto(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>|<\/(p|h\d|li|ul|pre|div|td|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Plantilla visual de los correos (mismos colores que la app: azul marino, dorado, fondo gris claro) ──
// Solo tablas y estilos en línea: es lo único que respetan Gmail, Outlook y Hotmail.
const FUENTE_CORREO = `'Sora',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** "2026-10-23" → "Viernes 23/10/2026". */
function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '';
  return `${DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()]} ${isoADMY(iso)}`;
}

/** Correo completo: cabecera azul marino con icono y título (como el "hero" de la app), tarjeta blanca y pie. */
function envoltorio(icono: string, titulo: string, cuerpoHTML: string): string {
  return `<div style="margin:0;padding:24px 12px;background:#f2f2f7;font-family:${FUENTE_CORREO};color:#1c1c1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;border-collapse:separate;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.09)">
<tr><td bgcolor="#0a1628" style="background:#0a1628;background-image:linear-gradient(160deg,#0a1628 0%,#0d2346 60%,#0f3060 100%);padding:28px 24px 26px;text-align:center">
<div style="display:inline-block;width:46px;height:46px;line-height:46px;font-size:22px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:13px">${icono}</div>
<h1 style="margin:12px 0 0;font-size:21px;font-weight:700;letter-spacing:-.02em;color:#ffffff">${titulo}</h1>
<p style="margin:5px 0 0;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#8a96a8">Puerto de Sevilla · Turnos</p>
<div style="width:22px;height:2px;margin:11px auto 0;background:#c9a84c;border-radius:2px"></div>
</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:15px;line-height:1.55;color:#1c1c1e">${cuerpoHTML}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid #e5e5ea;font-size:12px;line-height:1.5;color:#8e8e93;text-align:center">Puerto de Sevilla — Turnos<br>Este es un correo automático, no es necesario responder.</td></tr>
</table></div>`;
}

/** Tarjeta de turno: día en pequeño, franja horaria grande y borde de color a la izquierda. */
function tarjetaTurno(fecha: string, rango: string, color = '#0071e3', fondo = '#ddeeff', extra = ''): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-collapse:separate"><tr>
<td style="background:${fondo};border-left:4px solid ${color};border-radius:14px;padding:12px 16px">
<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}">${fecha}</div>
<div style="font-size:20px;font-weight:700;color:#0a1628;margin-top:2px">${rango}</div>${extra}
</td></tr></table>`;
}

/** Aviso destacado (la llave, etc.): caja de color suave. */
function aviso(icono: string, texto: string, color = '#7c3aed', fondo = '#f0e9ff'): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-collapse:separate"><tr>
<td style="background:${fondo};border-radius:14px;padding:12px 16px;font-size:14px;font-weight:600;color:${color}">${icono} ${texto}</td></tr></table>`;
}

/** Cuestionario de Google que se rellena al terminar el turno (el mismo enlace que sale en el PDF del cuadrante). */
const CUESTIONARIO_URL = Deno.env.get('CUESTIONARIO_URL') || 'https://forms.gle/CGyhjDJheehep5rNA';

/** Bloque con botón al cuestionario de fin de turno. */
function bloqueCuestionario(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 14px;border-collapse:separate"><tr>
<td style="background:#f5f7fa;border:1px solid #e5e5ea;border-radius:14px;padding:14px 16px;text-align:center">
<div style="font-size:13px;color:#48484a;margin-bottom:10px">Al terminar, rellena el cuestionario del turno:</div>
<a href="${CUESTIONARIO_URL}" style="display:inline-block;background:#0a1628;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:12px">📝 ¿Cómo fue el turno?</a>
<div style="font-size:11px;color:#8e8e93;margin-top:8px;word-break:break-all">${CUESTIONARIO_URL}</div>
</td></tr></table>`;
}

async function enviarCorreo(destinatario: string, asunto: string, html: string): Promise<boolean> {
  if (!RESEND_KEY || !RESEND_FROM) {
    console.warn('Faltan RESEND_API_KEY / RESEND_FROM — no se envía nada');
    return false;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [destinatario], subject: asunto, html, text: htmlATexto(html) }),
  });
  if (!r.ok) console.error('Error Resend:', r.status, await r.text());
  return r.ok;
}

// CORS: el envío manual llega desde el navegador del coordinador (planificador.html).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
function resp(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers || {}) } });
}
const json = (o: unknown, status = 200) => resp(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return resp('ok');
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return resp('no autorizado', { status: 401 });

  const ahoraMs = paredMadrid();
  const manana = isoDeMs(ahoraMs + 24 * 60 * 60 * 1000);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* el cron manda body vacío o "{}" */ }

  try {
    const { data: vols } = await sb.from('voluntarios').select('id,nombre,email,tiene_llave');
    const presentesDe = async (fecha: string): Promise<Fila[]> => {
      const [{ data: h }, { data: b }, { data: r }, { data: nr }] = await Promise.all([
        sb.from('historial').select('voluntario_id,rango').eq('fecha', fecha),
        sb.from('bajas').select('voluntario_id,rango,activa').eq('fecha', fecha),
        sb.from('refuerzos').select('voluntario_id,rango,es_dia_completo').eq('fecha', fecha),
        sb.from('turnos_no_realizados').select('rango').eq('fecha', fecha),
      ]);
      return presentesDelDia(h || [], b || [], r || [], nr || []);
    };
    const volPorId = new Map<string, Vol>((vols || []).map((v: any) => [v.id, v]));

    // ── Envío manual de un turno concreto (botón del planificador) ──
    if (payload?.turno?.fecha && payload?.turno?.rango) {
      const { fecha, rango } = payload.turno;
      const hoy = isoDeMs(ahoraMs);
      const cuandoCorto = fecha === hoy ? 'hoy' : fecha === manana ? 'mañana' : 'el';
      const cuando = cuandoCorto === 'el' ? `el ${isoADMY(fecha)}` : `${cuandoCorto} (${isoADMY(fecha)})`;
      const pres = await presentesDe(fecha);
      const enviados: string[] = [], sinEmail: string[] = [], fallidos: string[] = [];
      for (const f of pres.filter((x) => x.rango === rango)) {
        const v = volPorId.get(f.voluntario_id);
        if (!v) continue;
        if (!v.email) { sinEmail.push(v.nombre); continue; }
        const html = construirRecordatorio(v, cuando, fecha, [rango], pres, volPorId);
        if (await enviarCorreo(v.email, `Recordatorio: turno ${cuandoCorto} ${isoADMY(fecha)} · ${rango}`, html)) {
          enviados.push(v.nombre);
          if (fecha === manana) await sb.from('recordatorios_enviados').insert({ clave: `${v.id}|${manana}` });
        } else fallidos.push(v.nombre);
      }
      return json({ ok: true, fecha, rango, enviados, sinEmail, fallidos });
    }

    // ── Modo prueba: próximo turno de un voluntario concreto ──
    if (payload?.prueba_voluntario_id) {
      const v = volPorId.get(payload.prueba_voluntario_id);
      if (!v?.email) return resp('prueba: voluntario sin email', { status: 400 });
      const { data: prox } = await sb.from('historial').select('fecha').eq('voluntario_id', v.id)
        .gte('fecha', manana).order('fecha').limit(1);
      const fecha = prox?.[0]?.fecha;
      if (!fecha) return resp('prueba: no tiene turnos próximos', { status: 404 });
      const presDia = await presentesDe(fecha);
      const rangos = agruparPorVoluntario(presDia).get(v.id) || [];
      if (!rangos.length) return resp('prueba: en su próximo turno tiene baja o está anulado', { status: 404 });
      const html = construirRecordatorio(v, `el ${isoADMY(fecha)}`, fecha, rangos, presDia, volPorId);
      await enviarCorreo(v.email, `[PRUEBA] Recordatorio: turno el ${isoADMY(fecha)}`, html);
      return json({ ok: true, prueba: true, fecha, rangos });
    }

    const pres = await presentesDe(manana);
    const porVol = agruparPorVoluntario(pres);

    let enviados = 0;
    for (const [volId, rangos] of porVol) {
      const v = volPorId.get(volId);
      if (!v?.email) continue;
      const clave = `${volId}|${manana}`;
      const { data: ya } = await sb.from('recordatorios_enviados').select('clave').eq('clave', clave).limit(1);
      if (ya?.length) continue;

      const html = construirRecordatorio(v, `mañana (${isoADMY(manana)})`, manana, rangos, pres, volPorId);
      await enviarCorreo(v.email, `Recordatorio: turno mañana ${isoADMY(manana)}`, html);
      await sb.from('recordatorios_enviados').insert({ clave });
      enviados++;
    }
    return json({ ok: true, manana, enviados });
  } catch (e) {
    console.error(e);
    return resp('error: ' + (e as Error).message, { status: 500 });
  }
});
