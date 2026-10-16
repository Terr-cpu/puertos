// ══════════════════════════════════════════════════════════════
//  notificar-email — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Avisos por correo a cada VOLUNTARIO (a diferencia de notificar-telegram,
//  que avisa siempre al mismo chat del coordinador). Dos formas de llamarla:
//
//   1. Database Webhook sobre INSERT en "actividad" (supabase/01_actividad.sql):
//      tipo 'baja'           → confirmación de que su baja quedó registrada
//      tipo 'equipo_anadido' → su turno ha quedado confirmado
//      tipo 'equipo_quitado' → le han quitado de un turno ya confirmado
//      (el resto de tipos — apunte, apunte_cancelado, baja_anulada — no
//      generan correo; ya tienen su aviso de Telegram al coordinador)
//
//   2. Llamada directa desde disponibilidad-bloques.html al guardar con
//      éxito: { accion: 'disponibilidad_guardada', voluntario_id, resumenTexto }
//      — recibo de lo que ha quedado marcado. No pasa por webhook porque
//      guardar dispara ~20 filas en "disponibilidad" y un correo por fila
//      sería spam.
//
//  Si el voluntario no tiene email guardado (voluntarios.email), se ignora
//  sin error — el aviso de Telegram al coordinador sigue funcionando igual.
//
//  Despliegue y configuración: ver NOTIFICACIONES.md, Ampliación I.
//
//  Variables de entorno:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → automáticas
//   - RESEND_API_KEY   → Resend → API Keys
//   - RESEND_FROM      → remitente verificado, p. ej. "Turnos Puerto <avisos@tudominio.com>"
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM   = Deno.env.get('RESEND_FROM');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

// CORS: esta función la llama tanto un webhook de Supabase (servidor, sin CORS) como
// disponibilidad-bloques.html directamente desde el navegador del voluntario (modo
// "disponibilidad_guardada") — sin estas cabeceras, el navegador bloquea la llamada
// en silencio (el fetch va en un catch vacío) y el recibo nunca llega.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function resp(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers || {}) } });
}

function isoADMY(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** ¿Quien llama (token de su sesión) es el dueño de ese correo, o el admin? */
async function puedePedirRecibo(req: Request, emailVoluntario: string): Promise<boolean> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await sb.auth.getUser(token);
  const u = data?.user;
  if (error || !u) return false;
  if (u.app_metadata?.rol === 'admin') return true;
  return !!u.email && u.email.toLowerCase() === emailVoluntario.trim().toLowerCase();
}

async function voluntario(id: string | number | null): Promise<{ email: string | null; tieneLlave: boolean } | null> {
  if (!id) return null;
  const { data, error } = await sb.from('voluntarios').select('email,tiene_llave').eq('id', id).limit(1);
  if (error || !data?.length) return null;
  return { email: data[0].email || null, tieneLlave: !!data[0].tiene_llave };
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
<tr><td style="padding:0 24px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
<td style="background:#f5f7fa;border:1px solid #e5e5ea;border-radius:14px;padding:12px 16px;font-size:14px;line-height:1.5;color:#48484a">💬 Para cualquier duda o consulta, puedes ponerte en contacto con el hermano <b style="color:#0a1628">Manuel Fernández</b>.</td>
</tr></table></td></tr>
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

/** Anota el envío en registro_avisos (16_registro_avisos.sql). Si la tabla no existe, no pasa nada. */
async function registrar(meta: { tipo: string; voluntario_id?: string | null; nombre?: string | null } | undefined,
                         destino: string, asunto: string, ok: boolean, detalle = ''): Promise<void> {
  if (!meta) return;
  try {
    await sb.from('registro_avisos').insert({ canal: 'correo', tipo: meta.tipo, voluntario_id: meta.voluntario_id || null,
      nombre: meta.nombre || null, destino, asunto, ok, detalle: detalle ? detalle.slice(0, 300) : null });
  } catch (e) { /* sin tabla de registro: se envía igual */ }
}

async function enviarCorreo(destinatario: string, asunto: string, html: string,
                            meta?: { tipo: string; voluntario_id?: string | null; nombre?: string | null }): Promise<void> {
  if (!RESEND_KEY || !RESEND_FROM) {
    console.warn('Faltan RESEND_API_KEY / RESEND_FROM — no se envía nada');
    await registrar(meta, destinatario, asunto, false, 'Faltan RESEND_API_KEY / RESEND_FROM');
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [destinatario], subject: asunto, html, text: htmlATexto(html) }),
  });
  let detalle = '';
  if (!r.ok) { detalle = `Resend ${r.status}: ${await r.text()}`; console.error('Error Resend:', detalle); }
  await registrar(meta, destinatario, asunto, r.ok, detalle);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return resp('sin body', { status: 400 });
  }

  try {
    // ── Modo directo: recibo al guardar disponibilidad ──
    if (payload?.accion === 'disponibilidad_guardada') {
      const { voluntario_id, nombre, resumenTexto } = payload;
      const v = await voluntario(voluntario_id);
      if (!v?.email) return resp('sin email');
      // Solo el propio voluntario (con su sesión) o el admin: si no, cualquiera con la clave
      // pública podría mandar recibos a cualquier voluntario.
      if (!(await puedePedirRecibo(req, v.email))) return resp('no autorizado', { status: 403 });
      const html = envoltorio('📅', 'Disponibilidad guardada', `
        <p style="margin:0">Hola <b>${nombre || ''}</b>, hemos guardado tu disponibilidad:</p>
        <pre style="margin:14px 0;background:#f5f7fa;border:1px solid #e5e5ea;padding:12px 16px;border-radius:14px;white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.6;color:#1c1c1e">${resumenTexto || ''}</pre>
        <p style="margin:0 0 14px;color:#48484a">Si cambia tu horario habitual, puedes volver a enviarlo cuando quieras.</p>`);
      await enviarCorreo(v.email, 'Disponibilidad guardada — Turnos Puerto', html, { tipo: 'disponibilidad', voluntario_id, nombre });
      return resp('ok');
    }

    // ── Modo webhook: tabla "actividad" ──
    const { type, table, record } = payload || {};
    if (table !== 'actividad' || type !== 'INSERT' || !record) return resp('ignorado');

    const tipo = record.tipo;
    if (tipo !== 'baja' && tipo !== 'equipo_anadido' && tipo !== 'equipo_quitado') {
      return resp('ignorado (tipo sin correo)');
    }
    const v = await voluntario(record.voluntario_id);
    if (!v?.email) return resp('sin email');

    const nombre = record.nombre || '(voluntario)';
    const fecha = isoADMY(record.fecha);
    const dia = fechaLarga(record.fecha);
    const rango = record.rango || 'turno';

    if (tipo === 'baja') {
      const html = envoltorio('📝', 'Baja registrada', `
        <p style="margin:0">Hola <b>${nombre}</b>, hemos registrado tu baja para este turno:</p>
        ${tarjetaTurno(dia, rango, '#c0392b', '#fff0ef')}
        <p style="margin:0 0 14px;color:#48484a">Gracias por avisar.</p>`);
      await enviarCorreo(v.email, `Baja registrada — ${rango} del ${fecha}`, html, { tipo: 'baja', voluntario_id: record.voluntario_id, nombre });
    } else if (tipo === 'equipo_anadido') {
      const llaveTxt = v.tieneLlave ? aviso('🔑', 'Eres portador de llave — no olvides llevarla.') : '';
      const html = envoltorio('✅', 'Turno confirmado', `
        <p style="margin:0">Hola <b>${nombre}</b>, tu turno ha quedado confirmado:</p>
        ${tarjetaTurno(dia, rango, '#1a9648', '#e6f7ed')}
        ${llaveTxt}
        <p style="margin:0 0 14px;color:#48484a">¡Te esperamos!</p>
        ${bloqueCuestionario()}`);
      await enviarCorreo(v.email, `Turno confirmado — ${rango} del ${fecha}`, html, { tipo: 'turno_confirmado', voluntario_id: record.voluntario_id, nombre });
    } else if (tipo === 'equipo_quitado') {
      const html = envoltorio('⚠️', 'Cambios en tu turno', `
        <p style="margin:0">Hola <b>${nombre}</b>, este turno para el que estabas confirmado ha cambiado y <b>ya no cuentas en el equipo</b>:</p>
        ${tarjetaTurno(dia, rango, '#e07b00', '#fff3e0')}`);
      await enviarCorreo(v.email, `Cambios en tu turno — ${rango} del ${fecha}`, html, { tipo: 'turno_quitado', voluntario_id: record.voluntario_id, nombre });
    }
    return resp('ok');
  } catch (e) {
    console.error(e);
    return resp('error: ' + (e as Error).message, { status: 500 });
  }
});
