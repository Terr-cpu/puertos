// ══════════════════════════════════════════════════════════════
//  barcos-ais — señal AIS de los barcos del Golfo de Cádiz y el Guadalquivir
//  ────────────────────────────────────────────────────────────
//  Se conecta a aisstream.io (gratis) durante ESCUCHA segundos, junta lo que
//  llega de la zona y lo guarda en barcos_ais (última posición y datos de cada
//  barco) y barcos_ais_rastro (para dibujar el recorrido). La lanza pg_cron cada
//  5 minutos (17_barcos_ais.sql) y el planificador con "↻ Actualizar ahora".
//
//  Seguridad: misma cabecera x-cron-secret que recordatorios-turnos.
//  Secrets (Edge Functions → Secrets):
//   - AISSTREAM_API_KEY          la clave de https://aisstream.io (API Keys)
//   - CRON_SECRET_RECORDATORIOS  ya existe (la usa también recordatorios-turnos)
//
//  Por qué escuchar un minuto: los barcos en marcha mandan su posición cada pocos
//  segundos, pero los amarrados solo cada 3 minutos y los datos fijos (nombre,
//  destino, eslora) cada 6. Con varias pasadas se va completando todo.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AIS_KEY      = Deno.env.get('AISSTREAM_API_KEY');
const CRON_SECRET  = Deno.env.get('CRON_SECRET_RECORDATORIOS');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/** Zona: Golfo de Cádiz (para ver venir los barcos) y el Guadalquivir hasta Sevilla. [[lat, lon] SO, [lat, lon] NE] */
const ZONA = [[[36.30, -7.20], [37.45, -5.85]]];
const ESCUCHA = 55;              // segundos conectado en cada pasada
const DIAS_GUARDAR = 7;          // barcos sin señal desde hace más: se borran
const HORAS_RASTRO = 72;         // rastro que se conserva

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-cron-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

type Barco = Record<string, unknown> & { mmsi: number };

/** "2026-10-23 10:00:00.123456 +0000 UTC" → ISO. */
function horaAis(t: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(t || ''));
  return m ? `${m[1]}T${m[2]}Z` : null;
}

/** ETA que declara el barco (mes/día/hora/minuto, sin año) → fecha ISO, la más próxima a "ahora". */
function etaAis(e: any, ahora: Date): string | null {
  if (!e || !e.Month || !e.Day || e.Month > 12 || e.Day > 31 || e.Hour > 23 || e.Minute > 59) return null;
  let y = ahora.getUTCFullYear();
  let d = Date.UTC(y, e.Month - 1, e.Day, e.Hour ?? 0, e.Minute ?? 0);
  if (d < ahora.getTime() - 60 * 86400000) d = Date.UTC(++y, e.Month - 1, e.Day, e.Hour ?? 0, e.Minute ?? 0);
  return new Date(d).toISOString();
}

const limpio = (s: unknown) => String(s ?? '').replace(/@+/g, '').trim();

/**
 * Junta un mensaje de aisstream en `barcos` (por MMSI). Lógica pura, sin red — se prueba en test/.
 * Posiciones (PositionReport) y datos fijos (ShipStaticData) van por separado: así, al guardar,
 * cada cosa actualiza solo sus columnas y no borra lo que ya se sabía.
 */
function procesar(barcos: Map<number, { pos?: Barco; est?: Barco; nombre?: string }>, msg: any, ahora: Date): void {
  const meta = msg?.MetaData;
  const mmsi = Number(meta?.MMSI);
  if (!mmsi) return;
  const b = barcos.get(mmsi) || {};
  const nombre = limpio(meta?.ShipName);
  if (nombre) b.nombre = nombre;
  if (msg.MessageType === 'PositionReport') {
    const p = msg.Message?.PositionReport || {};
    const lat = Number(meta.latitude ?? p.Latitude), lon = Number(meta.longitude ?? p.Longitude);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    const ts = horaAis(meta.time_utc) || ahora.toISOString();
    if (b.pos && String(b.pos.pos_ts) > ts) { barcos.set(mmsi, b); return; }   // ya hay una más nueva
    b.pos = {
      mmsi, lat, lon,
      sog: p.Sog != null && p.Sog < 102.3 ? Math.round(p.Sog * 10) / 10 : null,
      cog: p.Cog != null && p.Cog < 360 ? Math.round(p.Cog) : null,
      rumbo: p.TrueHeading != null ? p.TrueHeading : null,
      estado_nav: p.NavigationalStatus != null ? p.NavigationalStatus : null,
      pos_ts: ts,
    };
  } else if (msg.MessageType === 'ShipStaticData') {
    const s = msg.Message?.ShipStaticData || {};
    const d = s.Dimension || {};
    b.est = {
      mmsi,
      nombre: limpio(s.Name) || nombre || null,
      imo: s.ImoNumber || null,
      indicativo: limpio(s.CallSign) || null,
      tipo: s.Type ?? null,
      eslora: (d.A || 0) + (d.B || 0) || null,
      manga: (d.C || 0) + (d.D || 0) || null,
      calado: s.MaximumStaticDraught || null,
      destino: limpio(s.Destination) || null,
      eta_ais: etaAis(s.Eta, ahora),
      estatico_ts: horaAis(meta.time_utc) || ahora.toISOString(),
    };
  }
  barcos.set(mmsi, b);
}

/** Escucha aisstream durante `segundos` y devuelve lo recogido. */
function escuchar(segundos: number, ahora: Date): Promise<{ barcos: Map<number, any>; mensajes: number; error?: string }> {
  return new Promise((resolve) => {
    const barcos = new Map<number, any>();
    let mensajes = 0, error: string | undefined, terminado = false;
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const fin = () => {
      if (terminado) return;
      terminado = true;
      try { ws.close(); } catch { /* ya cerrado */ }
      resolve({ barcos, mensajes, error });
    };
    const reloj = setTimeout(fin, segundos * 1000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ APIKey: AIS_KEY, BoundingBoxes: ZONA, FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    };
    ws.onmessage = async (ev: MessageEvent) => {
      try {
        const texto = typeof ev.data === 'string' ? ev.data : await new Response(ev.data).text();
        const msg = JSON.parse(texto);
        if (msg.error) { error = String(msg.error); clearTimeout(reloj); fin(); return; }
        mensajes++;
        procesar(barcos, msg, ahora);
      } catch { /* mensaje raro: se ignora */ }
    };
    ws.onerror = () => { error = error || 'No se pudo conectar con aisstream.io'; };
    ws.onclose = () => { clearTimeout(reloj); fin(); };
  });
}

/** Guarda lo recogido: posiciones, nombres y datos fijos por separado, y el rastro de los que se mueven. */
async function guardar(barcos: Map<number, any>, ahora: Date) {
  const pos: Barco[] = [], nombres: Barco[] = [], est: Barco[] = [], rastro: Record<string, unknown>[] = [];
  for (const b of barcos.values()) {
    if (b.pos) {
      pos.push({ ...b.pos, actualizado: ahora.toISOString() });
      rastro.push({ mmsi: b.pos.mmsi, ts: b.pos.pos_ts, lat: b.pos.lat, lon: b.pos.lon, sog: b.pos.sog });
    }
    if (b.est) est.push(b.est);
    else if (b.nombre && (b.pos?.mmsi)) nombres.push({ mmsi: b.pos.mmsi, nombre: b.nombre });
  }
  const errores: string[] = [];
  const up = async (filas: Barco[]) => {
    if (!filas.length) return;
    const { error } = await sb.from('barcos_ais').upsert(filas, { onConflict: 'mmsi' });
    if (error) errores.push(error.message);
  };
  await up(pos);
  await up(nombres);
  await up(est);
  if (rastro.length) {
    const { error } = await sb.from('barcos_ais_rastro').insert(rastro);
    if (error) errores.push(error.message);
  }
  // Limpieza: rastro viejo y barcos que hace días que no se ven
  await sb.from('barcos_ais_rastro').delete().lt('ts', new Date(ahora.getTime() - HORAS_RASTRO * 3600000).toISOString());
  await sb.from('barcos_ais').delete().lt('actualizado', new Date(ahora.getTime() - DIAS_GUARDAR * 86400000).toISOString());
  return { posiciones: pos.length, datos: est.length, errores };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ ok: false, error: 'no autorizado' }, 401);
  if (!AIS_KEY) return json({ ok: false, error: 'Falta el secret AISSTREAM_API_KEY (la clave de aisstream.io)' }, 500);
  let payload: any = {};
  try { payload = await req.json(); } catch { /* el cron manda {} */ }
  const segundos = Math.min(ESCUCHA, Math.max(5, Number(payload?.segundos) || ESCUCHA));
  const ahora = new Date();
  const r = await escuchar(segundos, ahora);
  const g = await guardar(r.barcos, ahora);
  return json({ ok: !r.error && !g.errores.length, segundos, mensajes: r.mensajes, barcos: r.barcos.size, ...g, error: r.error || g.errores[0] });
});
