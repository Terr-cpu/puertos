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
    .replace(/<br\s*\/?>|<\/(p|h\d|li|ul|pre|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function enviarCorreo(destinatario: string, asunto: string, html: string): Promise<void> {
  if (!RESEND_KEY || !RESEND_FROM) {
    console.warn('Faltan RESEND_API_KEY / RESEND_FROM — no se envía nada');
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [destinatario], subject: asunto, html, text: htmlATexto(html) }),
  });
  if (!r.ok) console.error('Error Resend:', r.status, await r.text());
}

function envoltorio(titulo: string, cuerpoHTML: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1c2b3a">
    <h2 style="color:#0f1f38;margin-bottom:.5rem">${titulo}</h2>
    ${cuerpoHTML}
    <p style="font-size:.78rem;color:#5c7a96;margin-top:2rem">Puerto de Sevilla — Turnos<br>Este es un correo automático, no es necesario responder.</p>
  </div>`;
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
      const html = envoltorio('Disponibilidad guardada', `
        <p>Hola ${nombre || ''}, hemos guardado tu disponibilidad:</p>
        <pre style="background:#f5f0e8;padding:.8rem 1rem;border-radius:8px;white-space:pre-wrap;font-family:inherit;font-size:.9rem">${resumenTexto || ''}</pre>
        <p>Si cambia tu horario habitual, puedes volver a enviarlo cuando quieras.</p>`);
      await enviarCorreo(v.email, 'Disponibilidad guardada — Turnos Puerto', html);
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
    const rango = record.rango || 'turno';

    if (tipo === 'baja') {
      const html = envoltorio('Baja registrada', `
        <p>Hola ${nombre}, hemos registrado tu baja para el turno <b>${rango}</b> del <b>${fecha}</b>.</p>
        <p>Gracias por avisar.</p>`);
      await enviarCorreo(v.email, `Baja registrada — ${rango} del ${fecha}`, html);
    } else if (tipo === 'equipo_anadido') {
      const llaveTxt = v.tieneLlave ? '<p>🔑 Eres portador de llave — no olvides llevarla.</p>' : '';
      const html = envoltorio('Turno confirmado', `
        <p>Hola ${nombre}, tu turno <b>${rango}</b> del <b>${fecha}</b> ha quedado confirmado.</p>
        ${llaveTxt}
        <p>¡Te esperamos!</p>`);
      await enviarCorreo(v.email, `Turno confirmado — ${rango} del ${fecha}`, html);
    } else if (tipo === 'equipo_quitado') {
      const html = envoltorio('Cambios en tu turno', `
        <p>Hola ${nombre}, el turno <b>${rango}</b> del <b>${fecha}</b> para el que estabas confirmado ha cambiado y ya no cuentas en el equipo.</p>
        <p>Si tienes dudas, contacta con el coordinador.</p>`);
      await enviarCorreo(v.email, `Cambios en tu turno — ${rango} del ${fecha}`, html);
    }
    return resp('ok');
  } catch (e) {
    console.error(e);
    return resp('error: ' + (e as Error).message, { status: 500 });
  }
});
