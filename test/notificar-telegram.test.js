// Prueba de supabase/functions/notificar-telegram/index.ts
// Carga el archivo tal cual con Supabase y Telegram simulados y ejercita cada
// tipo de evento que puede mandarle un Database Webhook.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'notificar-telegram', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ refuerzos = [] } = {}) {
  const codigo = stripTypeScriptTypes(fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, ''));
  const telegram = [];
  const sb = { from(t) {
    const q = { t, f: [] };
    const b = { select() { return b; }, eq(c, v) { q.f.push([c, v]); return b; }, limit() { return b; },
      then(ok, ko) {
        const data = t === 'voluntarios' ? [{ nombre: 'ANA PRUEBA' }] : t === 'refuerzos' ? refuerzos : [];
        return Promise.resolve({ data, error: null }).then(ok, ko);
      } };
    return b;
  } };
  let handler = null;
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const ctx = {
    console, Date, Math, JSON, Promise, Error, Intl, Response, String,
    createClient: () => sb,
    Deno: { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } },
    fetch: async (u, o) => { telegram.push(JSON.parse(o.body).text); return { ok: true, text: async () => '' }; },
    setTimeout: (fn) => fn(), // sin esperas reales
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { handler, telegram };
}
const post = (h, body) => h(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }));
const F = '2026-09-26', R = '10:00 a 12:00';

(async () => {
  console.log('\n═══ notificar-telegram — eventos de los webhooks ═══');
  let r = cargar();
  await post(r.handler, { type: 'INSERT', table: 'bajas', record: { voluntario_id: 'a', fecha: F, rango: R, activa: true } });
  check('baja nueva → "Baja comunicada"', r.telegram.length === 1 && /Baja comunicada/.test(r.telegram[0]) && /ANA PRUEBA/.test(r.telegram[0]) && /26\/09\/2026/.test(r.telegram[0]));

  r = cargar();
  await post(r.handler, { type: 'INSERT', table: 'bajas', record: { voluntario_id: 'a', fecha: F, rango: R, activa: false } });
  check('baja insertada ya inactiva → sin aviso', r.telegram.length === 0);

  r = cargar();
  await post(r.handler, { type: 'UPDATE', table: 'bajas', record: { voluntario_id: 'a', fecha: F, rango: R, activa: true }, old_record: { activa: false } });
  check('UPDATE que reactiva una baja anulada → aviso (antes se perdía)', r.telegram.length === 1 && /Baja comunicada/.test(r.telegram[0]));

  r = cargar();
  await post(r.handler, { type: 'UPDATE', table: 'bajas', record: { voluntario_id: 'a', fecha: F, rango: R, activa: false }, old_record: { activa: true } });
  await post(r.handler, { type: 'UPDATE', table: 'bajas', record: { voluntario_id: 'a', fecha: F, rango: R, activa: true }, old_record: { activa: true } });
  check('UPDATE que anula o que no cambia el estado → sin aviso', r.telegram.length === 0);

  r = cargar();
  await post(r.handler, { type: 'INSERT', table: 'refuerzos', record: { voluntario_id: 'a', fecha: F, rango: R, es_dia_completo: false } });
  await post(r.handler, { type: 'INSERT', table: 'refuerzos', record: { voluntario_id: 'a', fecha: F, rango: null, es_dia_completo: true } });
  check('apunte a turno y apunte de día completo', r.telegram.length === 2 && /✋ <b>Nuevo apunte/.test(r.telegram[0]) && /📅 <b>Nuevo apunte/.test(r.telegram[1]) && /todo el día/.test(r.telegram[1]));

  r = cargar();
  await post(r.handler, { type: 'UPDATE', table: 'refuerzos', record: { voluntario_id: 'a', fecha: F, rango: R }, old_record: {} });
  check('UPDATE de refuerzos → sin aviso', r.telegram.length === 0);

  r = cargar();
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'apunte_cancelado', voluntario_id: 'a', nombre: 'ANA PRUEBA', fecha: F, rango: R } });
  check('apunte cancelado (actividad) → "Apunte cancelado"', r.telegram.length === 1 && /Apunte cancelado/.test(r.telegram[0]) && /ANA PRUEBA/.test(r.telegram[0]));

  r = cargar({ refuerzos: [] });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'baja_anulada', voluntario_id: 'a', nombre: 'ANA PRUEBA', fecha: F, rango: R } });
  check('baja anulada sin apunte → "Baja anulada"', r.telegram.length === 1 && /Baja anulada/.test(r.telegram[0]));

  r = cargar({ refuerzos: [{ id: 1 }] });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'baja_anulada', voluntario_id: 'a', nombre: 'ANA PRUEBA', fecha: F, rango: R } });
  check('baja anulada CON apunte de la misma persona (reincorporación) → no duplica el aviso', r.telegram.length === 0);

  r = cargar();
  for (const tipo of ['baja', 'apunte', 'equipo_anadido', 'equipo_quitado']) {
    await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo, voluntario_id: 'a', fecha: F, rango: R } });
  }
  check('el resto de tipos de actividad no generan aviso (ya tienen el suyo o son del admin)', r.telegram.length === 0);

  r = cargar();
  const resp = await r.handler(new Request('http://x/', { method: 'POST', body: 'no json' }));
  check('cuerpo inválido → 400', resp.status === 400);

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
