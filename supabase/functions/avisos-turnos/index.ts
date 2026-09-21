// ══════════════════════════════════════════════════════════════
//  avisos-turnos — Supabase Edge Function (aviso de "turno en riesgo")
//  ────────────────────────────────────────────────────────────
//  Lo lanza una tarea programada (pg_cron, ver supabase/02_avisos.sql) cada hora.
//  Mira los turnos que empiezan en las próximas HORIZONTE_H horas (48 por
//  defecto) y avisa por Telegram de los que no llegan al mínimo de voluntarios.
//  No repite el mismo aviso: solo vuelve a escribir si cambia la situación
//  (alguien se apunta o se da de baja) y avisa una vez cuando el hueco se cubre.
//
//  Secrets (Edge Functions → Secrets):
//   - TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   (los mismos que notificar-telegram)
//   - CRON_SECRET     texto cualquiera; el mismo que se pone en 02_avisos.sql
//   - MIN_EQ          opcional, mínimo de voluntarios por turno (3 por defecto)
//   - HORIZONTE_H     opcional, horas de antelación (48 por defecto)
//  Esta función se despliega con "Verify JWT" DESACTIVADO (la protege CRON_SECRET).
//  Un solo archivo a propósito: se pega tal cual en el editor del panel de Supabase.
//  La lógica (secciones 1 y 2) se prueba en test/avisos-turnos.test.js.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// ─────────── 1 · LÓGICA PURA (sin red ni base de datos) ───────────
// Mismo criterio que la pestaña "En vivo" de planificador.html:
// presentes = equipo − bajas activas + apuntados (baja + apunte de la misma persona = se reincorpora).
interface Cfg { minEq: number; horizonteH: number; horaDesde: number; horaHasta: number }
interface Turno {
  clave: string; fecha: string; rango: string;
  n: number; faltan: number;
  presentes: string[]; bajas: string[];
  horasHasta: number;
}
type Accion =
  | { tipo: 'riesgo'; turno: Turno }
  | { tipo: 'cubierto'; turno: Turno }
  | { tipo: 'limpiar'; clave: string };

/** "Hora de pared" de Madrid como milisegundos (fecha y hora locales tratadas como UTC). */
function paredMadrid(d: Date = new Date()): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
}

function inicioTurnoMs(fecha: string, rango: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*a\s*(\d{1,2}):(\d{2})/.exec(rango || '');
  if (!m) return null;
  const [y, mo, d] = fecha.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, +m[1], +m[2]);
}
function horas(rango: string): [number, number] | null {
  const m = /(\d{1,2}):\d{2}\s*a\s*(\d{1,2}):\d{2}/.exec(rango || '');
  return m ? [+m[1], +m[2]] : null;
}

/** Turnos cuya hora de inicio queda dentro del horizonte, con su recuento de presentes. */
function evaluarTurnos(
  datos: { hist: any[]; bajas: any[]; refs: any[]; cal: any[]; vols: any[]; noReal?: any[] },
  ahoraMs: number, cfg: Cfg,
): Turno[] {
  const nombreDe = new Map<string, string>((datos.vols || []).map((v) => [v.id, v.nombre]));
  const mapa = new Map<string, any>();
  const get = (fecha: string, rango: string) => {
    const k = fecha + '|' + rango;
    if (!mapa.has(k)) mapa.set(k, { fecha, rango, equipo: [], bajas: [], apuntes: [], abierto: false });
    return mapa.get(k);
  };
  for (const h of datos.hist || []) get(h.fecha, h.rango).equipo.push({ id: h.voluntario_id, nombre: h.nombre });
  for (const b of datos.bajas || []) {
    if (b.activa && b.rango) get(b.fecha, b.rango).bajas.push({ id: b.voluntario_id, nombre: nombreDe.get(b.voluntario_id) || '(voluntario)' });
  }
  for (const r of datos.refs || []) {
    if (r.es_dia_completo || !r.rango) continue;
    get(r.fecha, r.rango).apuntes.push({ id: r.voluntario_id, nombre: r.nombre });
  }
  for (const c of datos.cal || []) {
    if (!c.activo) continue;
    for (const n of Array.isArray(c.navieras) ? c.navieras : []) {
      if (String(n).startsWith('turno:')) get(c.fecha, String(n).slice(6)).abierto = true;
    }
  }

  const res: any[] = [];
  for (const t of mapa.values()) {
    const bajaIds = new Set(t.bajas.map((b: any) => b.id));
    const apIds = new Set(t.apuntes.map((a: any) => a.id));
    const eqIds = new Set(t.equipo.map((e: any) => e.id));
    const presentes: string[] = [];
    for (const e of t.equipo) if (!bajaIds.has(e.id) || apIds.has(e.id)) presentes.push(e.nombre);
    for (const a of t.apuntes) if (!eqIds.has(a.id)) presentes.push(a.nombre);
    t.presentes = presentes;
    t.bajasNombres = t.bajas.filter((b: any) => !apIds.has(b.id)).map((b: any) => b.nombre);
    res.push(t);
  }

  // Turnos anulados a mano (planificador → Bajas → Anular turno): no hay nada que avisar
  const anulados = new Set<string>((datos.noReal || []).map((r) => r.fecha + '|' + r.rango));
  const out: Turno[] = [];
  for (const t of res) {
    if (anulados.has(t.fecha + '|' + t.rango)) continue;
    const ini = inicioTurnoMs(t.fecha, t.rango);
    if (ini === null) continue;
    const horasHasta = (ini - ahoraMs) / 3600000;
    // Una franja habilitada y vacía que se pisa con otro turno ya con gente no es un hueco real
    if (t.presentes.length === 0 && t.abierto) {
      const a = horas(t.rango);
      const pisa = res.some((o) => {
        const b = horas(o.rango);
        return o !== t && o.fecha === t.fecha && o.presentes.length > 0 && a && b && a[0] < b[1] && b[0] < a[1];
      });
      if (pisa) continue;
    }
    // Un turno sin ninguna marca (solo habilitado o vacío) sigue contando: es un hueco abierto
    out.push({
      clave: t.fecha + '|' + t.rango, fecha: t.fecha, rango: t.rango,
      n: t.presentes.length, faltan: Math.max(0, cfg.minEq - t.presentes.length),
      presentes: t.presentes, bajas: t.bajasNombres, horasHasta,
    });
  }
  return out.filter((t) => t.horasHasta > 0 && t.horasHasta <= cfg.horizonteH)
    .sort((a, b) => a.horasHasta - b.horasHasta);
}

/**
 * Decide qué avisar. `avisados` = lo que ya se comunicó (clave → nº de presentes
 * en ese momento). Solo se vuelve a avisar si la situación cambia (otro número
 * de presentes), y se avisa una vez cuando el hueco se resuelve.
 */
function decidir(turnos: Turno[], avisados: Map<string, number>, cfg: Cfg): Accion[] {
  const acciones: Accion[] = [];
  const vistos = new Set<string>();
  for (const t of turnos) {
    vistos.add(t.clave);
    const antes = avisados.get(t.clave);
    if (t.n < cfg.minEq) {
      if (antes === undefined || antes !== t.n) acciones.push({ tipo: 'riesgo', turno: t });
    } else if (antes !== undefined) {
      acciones.push({ tipo: 'cubierto', turno: t });
    }
  }
  // Avisos guardados de turnos que ya no están en el horizonte (pasaron o cambió el calendario)
  for (const clave of avisados.keys()) if (!vistos.has(clave)) acciones.push({ tipo: 'limpiar', clave });
  return acciones;
}

/** ¿Es buena hora para escribir a alguien? (hora de Madrid) */
function horaPermitida(ahoraMs: number, cfg: Cfg): boolean {
  const h = new Date(ahoraMs).getUTCHours();
  return h >= cfg.horaDesde && h <= cfg.horaHasta;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function esc(s: string): string { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)); }
function cuando(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
function enHoras(h: number): string {
  if (h < 1) return 'en menos de 1 h';
  return `en ${Math.round(h)} h`;
}

/** Un único mensaje de Telegram con todas las novedades de la pasada (o null). */
function mensaje(acciones: Accion[], urlSust: string): string | null {
  const riesgo = acciones.filter((a) => a.tipo === 'riesgo') as Extract<Accion, { tipo: 'riesgo' }>[];
  const cubiertos = acciones.filter((a) => a.tipo === 'cubierto') as Extract<Accion, { tipo: 'cubierto' }>[];
  if (!riesgo.length && !cubiertos.length) return null;
  const partes: string[] = [];
  if (riesgo.length) {
    partes.push(`⚠️ <b>${riesgo.length === 1 ? 'Turno en riesgo' : riesgo.length + ' turnos en riesgo'}</b>`);
    for (const { turno: t } of riesgo) {
      const estado = t.n === 0 ? '🚨 sin nadie apuntado' : `faltan ${t.faltan} (hay ${t.n}: ${t.presentes.map(esc).join(', ')})`;
      partes.push(`\n📅 <b>${cuando(t.fecha)} · ${esc(t.rango)}</b> (${enHoras(t.horasHasta)})\n${estado}` +
        (t.bajas.length ? `\n🏥 Baja: ${t.bajas.map(esc).join(', ')}` : ''));
    }
    partes.push(`\n👉 ${urlSust}`);
  }
  if (cubiertos.length) {
    partes.push(`${riesgo.length ? '\n' : ''}✅ <b>Ya cubierto</b>`);
    for (const { turno: t } of cubiertos) partes.push(`${cuando(t.fecha)} · ${esc(t.rango)} — ${t.n} voluntarios`);
  }
  return partes.join('\n');
}

// ─────────── 2 · ENTRADA/SALIDA (Supabase + Telegram) ───────────
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const URL_SUST = 'https://terr-cpu.github.io/puertos/sustituciones.html';

const CFG: Cfg = {
  minEq: Number(Deno.env.get('MIN_EQ') || 3),
  horizonteH: Number(Deno.env.get('HORIZONTE_H') || 48),
  horaDesde: 8, horaHasta: 21, // no escribir de noche (hora de Madrid)
};

async function enviarTelegram(texto: string): Promise<void> {
  if (!TOKEN || !CHAT) throw new Error('Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error('Telegram ' + r.status + ': ' + await r.text());
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('no autorizado', { status: 401 });
  try {
    const ahora = paredMadrid();
    const dryRun = new URL(req.url).searchParams.get('dry') === '1'; // ?dry=1 → no envía ni guarda, solo muestra
    if (!dryRun && !horaPermitida(ahora, CFG)) return new Response('fuera de horario');

    const hoy = new Date(ahora).toISOString().slice(0, 10);
    const hasta = new Date(ahora + (CFG.horizonteH / 24 + 2) * 86400000).toISOString().slice(0, 10);
    const q = (t: string, cols: string) => sb.from(t).select(cols).gte('fecha', hoy).lte('fecha', hasta);
    const [hist, bajas, refs, cal, vols, av, nr] = await Promise.all([
      q('v_historial', 'fecha,rango,nombre,voluntario_id'),
      q('bajas', 'fecha,rango,voluntario_id,activa'),
      q('v_refuerzos', 'fecha,rango,nombre,voluntario_id,es_dia_completo'),
      q('v_calendario', 'fecha,activo,navieras'),
      sb.from('voluntarios').select('id,nombre'),
      sb.from('avisos_enviados').select('clave,n'),
      q('turnos_no_realizados', 'fecha,rango'),   // si la tabla aún no existe se ignora
    ]);
    for (const r of [hist, bajas, refs, cal, vols, av]) if (r.error) throw new Error(r.error.message);

    const turnos = evaluarTurnos(
      { hist: hist.data!, bajas: bajas.data!, refs: refs.data!, cal: cal.data!, vols: vols.data!, noReal: nr.error ? [] : (nr.data as any[]) }, ahora, CFG);
    const avisados = new Map<string, number>((av.data || []).map((a: any) => [a.clave, a.n]));
    const acciones = decidir(turnos, avisados, CFG);
    const texto = mensaje(acciones, URL_SUST);

    if (dryRun) return Response.json({ ahora: new Date(ahora).toISOString(), turnos, acciones, texto });

    if (texto) await enviarTelegram(texto);
    // Solo se anota lo avisado DESPUÉS de enviar: si Telegram falla, se reintenta en la siguiente pasada
    for (const a of acciones) {
      if (a.tipo === 'riesgo') await sb.from('avisos_enviados').upsert({ clave: a.turno.clave, n: a.turno.n, ts: new Date().toISOString() });
      else if (a.tipo === 'cubierto') await sb.from('avisos_enviados').delete().eq('clave', a.turno.clave);
      else await sb.from('avisos_enviados').delete().eq('clave', a.clave);
    }
    return new Response(texto ? 'avisado' : 'sin novedades');
  } catch (e) {
    console.error(e);
    return new Response('error: ' + (e as Error).message, { status: 500 });
  }
});
