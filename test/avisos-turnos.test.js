// Prueba de supabase/functions/avisos-turnos/index.ts
// Carga el archivo tal cual (le quita los tipos con node:module), lo evalúa con
// Supabase, Telegram y el reloj simulados, y ejercita la función completa:
// autorización, horario, qué turnos se avisan, no repetir, "ya cubierto" y limpieza.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'avisos-turnos', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

// ── Carga del módulo con entorno simulado ──
function cargar({ ahoraUTC, datos, avisados, env = {} }) {
  let codigo = fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, '');
  codigo = stripTypeScriptTypes(codigo) +
    '\n;globalThis.__f = { evaluarTurnos, decidir, mensaje, paredMadrid, horaPermitida };';

  const escrituras = [], telegram = [];
  const FIJO = new Date(ahoraUTC).getTime();
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FIJO); }
    static now() { return FIJO; }
  }
  const sbFalso = {
    from(tabla) {
      const q = { tabla, op: 'select', filtros: [] };
      const b = {
        select() { return b; }, gte() { return b; }, lte() { return b; },
        eq(c, v) { q.filtros.push([c, v]); return b; },
        delete() { q.op = 'delete'; return b; },
        upsert(fila) { q.op = 'upsert'; q.fila = fila; return b; },
        then(ok, ko) {
          let r;
          if (q.op === 'select') {
            const mapa = { v_historial: datos.hist, bajas: datos.bajas, v_refuerzos: datos.refs, v_calendario: datos.cal, turnos_no_realizados: datos.noReal || [], voluntarios: datos.vols, avisos_enviados: [...avisados].map(([clave, n]) => ({ clave, n })) };
            r = { data: mapa[tabla] || [], error: null };
          } else { escrituras.push({ tabla, op: q.op, fila: q.fila, filtros: q.filtros }); r = { data: null, error: null }; }
          return Promise.resolve(r).then(ok, ko);
        },
      };
      return b;
    },
  };
  let handler = null;
  const entorno = { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', CRON_SECRET: 'sec', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', ...env };
  const ctx = {
    console, Date: FakeDate, Math, JSON, Set, Map, Array, Object, String, Number, RegExp, Promise, Error, Intl,
    URL, Request, Response, Headers,
    createClient: () => sbFalso,
    Deno: { env: { get: (k) => entorno[k] }, serve: (fn) => { handler = fn; } },
    fetch: async (url, opts) => { telegram.push({ url, body: JSON.parse(opts.body) }); return { ok: true, text: async () => '' }; },
    globalThis: {},
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { f: ctx.globalThis.__f, handler, escrituras, telegram };
}

const req = (secreto, query = '') => new Request('http://x/' + query, { headers: secreto ? { 'x-cron-secret': secreto } : {} });
const V = (id, nombre) => ({ id, nombre });
const H = (fecha, rango, id, nombre) => ({ fecha, rango, voluntario_id: id, nombre });
const B = (fecha, rango, id) => ({ fecha, rango, voluntario_id: id, activa: true });

// "Ahora" simulado: jueves 24/09/2026 10:30 en Madrid (verano → 08:30 UTC)
const AHORA = '2026-09-24T08:30:00Z';
const vols = ['j', 'k', 'l', 'm', 'n', 'o', 'p', 'q'].map((id) => V(id, id.toUpperCase() + ' APELLIDO'));
const D25 = '2026-09-25', D26 = '2026-09-26';

function escenario() {
  return {
    vols,
    hist: [
      // A: 25/09 10-12 — 4 personas, TODAS de baja → 0 presentes
      H(D25, '10:00 a 12:00', 'j', 'J APELLIDO'), H(D25, '10:00 a 12:00', 'k', 'K APELLIDO'), H(D25, '10:00 a 12:00', 'l', 'L APELLIDO'), H(D25, '10:00 a 12:00', 'm', 'M APELLIDO'),
      // C: 25/09 19-21 — 4 personas sin bajas → correcto
      H(D25, '19:00 a 21:00', 'j', 'J APELLIDO'), H(D25, '19:00 a 21:00', 'k', 'K APELLIDO'), H(D25, '19:00 a 21:00', 'l', 'L APELLIDO'), H(D25, '19:00 a 21:00', 'm', 'M APELLIDO'),
      // E: 25/09 16-18 — solo 2 → falta 1
      H(D25, '16:00 a 18:00', 'n', 'N APELLIDO'), H(D25, '16:00 a 18:00', 'o', 'O APELLIDO'),
      // B: 26/09 19-21 — solo 1, pero queda a >48 h → no se avisa aún
      H(D26, '19:00 a 21:00', 'p', 'P APELLIDO'),
      // D: 24/09 08-10 — ya empezó → fuera
      H('2026-09-24', '08:00 a 10:00', 'q', 'Q APELLIDO'),
    ],
    bajas: [B(D25, '10:00 a 12:00', 'j'), B(D25, '10:00 a 12:00', 'k'), B(D25, '10:00 a 12:00', 'l'), B(D25, '10:00 a 12:00', 'm')],
    refs: [],
    // F: franja habilitada 18-20 vacía que se pisa con C (19-21, con gente) → no es un hueco real
    cal: [{ fecha: D25, activo: true, navieras: ['MSC', 'turno:18:00 a 20:00'] }],
  };
}

(async () => {
  console.log('\n═══ Aviso de turno en riesgo — función completa ═══');
  let e = escenario(), avisados = new Map();

  // 1 · Seguridad y horario
  let r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  check('sin cabecera x-cron-secret → 401', (await r.handler(req(null))).status === 401);
  check('con secreto incorrecto → 401', (await r.handler(req('mal'))).status === 401);
  const noche = cargar({ ahoraUTC: '2026-09-24T21:30:00Z', datos: e, avisados }); // 23:30 en Madrid
  check('de noche (23:30 Madrid) no escribe', (await (await noche.handler(req('sec'))).text()) === 'fuera de horario' && noche.telegram.length === 0);

  // 2 · Primera pasada
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  const dry = await (await r.handler(req('sec', '?dry=1'))).json();
  const claves = dry.turnos.map((t) => t.clave);
  check('el turno con todos de baja aparece (0 presentes)', dry.turnos.find((t) => t.clave === D25 + '|10:00 a 12:00')?.n === 0);
  check('el turno con 2 personas aparece (falta 1)', dry.turnos.find((t) => t.clave === D25 + '|16:00 a 18:00')?.faltan === 1);
  check('el turno completo no genera aviso', !dry.acciones.some((a) => a.turno?.clave === D25 + '|19:00 a 21:00'));
  check('el turno a más de 48 h queda fuera', !claves.includes(D26 + '|19:00 a 21:00'));
  check('el turno que ya empezó queda fuera', !claves.includes('2026-09-24|08:00 a 10:00'));
  check('la franja vacía que se pisa con un turno cubierto se ignora', !claves.includes(D25 + '|18:00 a 20:00'));
  check('modo dry no envía ni escribe', r.telegram.length === 0 && r.escrituras.length === 0);

  r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  const resp = await r.handler(req('sec'));
  check('envía UN mensaje con los dos turnos', resp.status === 200 && r.telegram.length === 1, 'mensajes: ' + r.telegram.length);
  const txt = r.telegram[0]?.body.text || '';
  check('el mensaje dice sin nadie / faltan 1 / baja y enlace', /sin nadie apuntado/.test(txt) && /faltan 1/.test(txt) && /🏥 Baja: J APELLIDO/.test(txt) && /sustituciones\.html/.test(txt), '\n' + txt.split('\n').map((l) => '      ' + l).join('\n'));
  check('chat/parse_mode correctos', r.telegram[0].body.chat_id === '42' && r.telegram[0].body.parse_mode === 'HTML');
  const guardados = r.escrituras.filter((w) => w.op === 'upsert').map((w) => w.fila.clave + '=' + w.fila.n).sort();
  check('anota lo avisado tras enviar (A=0, E=2)', guardados.join() === [D25 + '|10:00 a 12:00=0', D25 + '|16:00 a 18:00=2'].sort().join(), guardados.join(' '));

  // 3 · No repetir
  avisados = new Map([[D25 + '|10:00 a 12:00', 0], [D25 + '|16:00 a 18:00', 2]]);
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  check('misma situación → no vuelve a avisar', (await (await r.handler(req('sec'))).text()) === 'sin novedades' && r.telegram.length === 0);

  // 4 · Cambia la situación: alguien se apunta al turno A (0 → 1) → nuevo aviso
  e = escenario(); e.refs = [{ fecha: D25, rango: '10:00 a 12:00', voluntario_id: 'p', nombre: 'P APELLIDO', es_dia_completo: false }];
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  await r.handler(req('sec'));
  check('un apunte cambia 0→1 presentes: se avisa de nuevo', r.telegram.length === 1 && /faltan 2 \(hay 1: P APELLIDO\)/.test(r.telegram[0].body.text), r.telegram[0]?.body.text.split('\n')[2]);

  // 5 · El hueco se cubre: E pasa a 3 → "Ya cubierto" y se borra el registro
  e = escenario(); e.hist.push(H(D25, '16:00 a 18:00', 'p', 'P APELLIDO'));
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados });
  await r.handler(req('sec'));
  check('turno cubierto → mensaje "Ya cubierto"', r.telegram.length === 1 && /Ya cubierto/.test(r.telegram[0].body.text) && /16:00 a 18:00/.test(r.telegram[0].body.text));
  check('se borra el aviso guardado del turno cubierto', r.escrituras.some((w) => w.op === 'delete' && w.filtros.some(([, v]) => v === D25 + '|16:00 a 18:00')));

  // 6 · Limpieza de avisos de turnos que ya pasaron
  avisados = new Map([['2026-09-20|10:00 a 12:00', 1]]);
  r = cargar({ ahoraUTC: AHORA, datos: escenario(), avisados });
  await r.handler(req('sec'));
  check('avisos de turnos pasados se limpian sin enviar nada de ellos', r.escrituras.some((w) => w.op === 'delete' && w.filtros.some(([, v]) => v === '2026-09-20|10:00 a 12:00')) && !/2026-09-20|20\/09/.test(r.telegram[0]?.body.text || ''));

  // 7 · Reincorporación: baja + apunte de la misma persona cuenta como presente
  e = escenario(); e.refs = ['j', 'k', 'l'].map((id) => ({ fecha: D25, rango: '10:00 a 12:00', voluntario_id: id, nombre: id.toUpperCase() + ' APELLIDO', es_dia_completo: false }));
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados: new Map() });
  const d7 = await (await r.handler(req('sec', '?dry=1'))).json();
  check('baja + apunte de la misma persona = presente (3 de 4 vuelven)', d7.turnos.find((t) => t.clave === D25 + '|10:00 a 12:00').n === 3);

  // 7b · Turno anulado a mano: no se avisa (y se limpia su aviso anterior)
  e = escenario(); e.noReal = [{ fecha: D25, rango: '10:00 a 12:00' }];
  r = cargar({ ahoraUTC: AHORA, datos: e, avisados: new Map([[D25 + '|10:00 a 12:00', 0]]) });
  const dAn = await (await r.handler(req('sec', '?dry=1'))).json();
  check('un turno anulado a mano desaparece de los avisos (10-12 vacío)', !dAn.turnos.some((t) => t.clave === D25 + '|10:00 a 12:00') && dAn.turnos.some((t) => t.clave === D25 + '|16:00 a 18:00'));
  await r.handler(req('sec'));
  check('y no se le manda ningún mensaje; su aviso anterior se limpia', !/10:00 a 12:00/.test(r.telegram[0]?.body.text || '') && r.escrituras.some((w) => w.op === 'delete' && w.filtros.some(([, v]) => v === D25 + '|10:00 a 12:00')));

  // 8 · Hora de pared de Madrid, con cambio horario (invierno = UTC+1)
  const inv = cargar({ ahoraUTC: '2026-12-10T08:30:00Z', datos: e, avisados: new Map() });
  check('paredMadrid en invierno = UTC+1 (09:30)', new Date(inv.f.paredMadrid(new Date('2026-12-10T08:30:00Z'))).toISOString() === '2026-12-10T09:30:00.000Z');
  check('paredMadrid en verano = UTC+2 (10:30)', new Date(inv.f.paredMadrid(new Date(AHORA))).toISOString() === '2026-09-24T10:30:00.000Z');

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
