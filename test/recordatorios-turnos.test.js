// Prueba de supabase/functions/recordatorios-turnos/index.ts
// Carga el archivo tal cual con Supabase, Resend y el reloj simulados.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'recordatorios-turnos', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ ahoraUTC, hist = [], vols = [], yaEnviados = [], bajas = [], refs = [], anulados = [], env = {} }) {
  let codigo = fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, '');
  codigo = stripTypeScriptTypes(codigo) + '\n;globalThis.__f = { agruparPorVoluntario };';

  const FIJO = new Date(ahoraUTC).getTime();
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FIJO); }
    static now() { return FIJO; }
  }
  const correos = [], insertados = [];
  const sb = {
    from(t) {
      const q = { t, filtros: [] };
      const b = {
        select() { return b; }, eq(c, v) { q.filtros.push([c, v]); return b; }, limit() { return b; },
        gte(c, v) { q.desde = v; return b; }, order() { return b; },
        insert(fila) { insertados.push({ t, fila }); return Promise.resolve({ data: null, error: null }); },
        then(ok, ko) {
          let data;
          if (t === 'historial') {
            const fechaF = (q.filtros.find(f => f[0] === 'fecha') || [])[1];
            const volF = (q.filtros.find(f => f[0] === 'voluntario_id') || [])[1];
            data = hist.filter(h => (!fechaF || h.fecha === fechaF) && (!volF || h.voluntario_id === volF) && (!q.desde || h.fecha >= q.desde))
              .sort((x, y) => x.fecha.localeCompare(y.fecha));
          }
          else if (t === 'voluntarios') data = vols;
          else if (t === 'bajas' || t === 'refuerzos' || t === 'turnos_no_realizados') {
            const fechaF = (q.filtros.find(f => f[0] === 'fecha') || [])[1];
            data = ({ bajas, refuerzos: refs, turnos_no_realizados: anulados })[t].filter(x => !fechaF || x.fecha === fechaF);
          }
          else if (t === 'recordatorios_enviados') {
            const clave = (q.filtros.find(f => f[0] === 'clave') || [])[1];
            data = yaEnviados.includes(clave) ? [{ clave }] : [];
          } else data = [];
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return b;
    },
  };
  let handler = null;
  const entorno = { RESEND_API_KEY: 'k', RESEND_FROM: 'a@x.com', CRON_SECRET_RECORDATORIOS: 'sec', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', ...env };
  const ctx = {
    console, Math, JSON, Promise, Error, Intl, Response, String, Date: FakeDate,
    createClient: () => sb,
    Deno: { env: { get: (k) => entorno[k] }, serve: (fn) => { handler = fn; } },
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; },
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { handler, correos, insertados, f: ctx.__f };
}

const llamar = (h, secret, body = {}) => h(new Request('http://x/', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {}, body: JSON.stringify(body) }));

(async () => {
  console.log('\n═══ recordatorios-turnos — recordatorio diario por correo ═══');

  let r = cargar({ ahoraUTC: '2026-09-25T12:00:00Z' });
  const sinSecreto = await llamar(r.handler, null);
  check('sin x-cron-secret → 401', sinSecreto.status === 401);
  const malSecreto = await llamar(r.handler, 'otro');
  check('con secreto incorrecto → 401', malSecreto.status === 401);

  check('agruparPorVoluntario junta por voluntario_id',
    (() => {
      const m = r.f.agruparPorVoluntario([{ voluntario_id: 'a', rango: '10:00 a 12:00' }, { voluntario_id: 'a', rango: '16:00 a 18:00' }, { voluntario_id: 'b', rango: '08:00 a 10:00' }]);
      return m.get('a').length === 2 && m.get('b').length === 1;
    })());

  // 25/09/2026 (viernes) a mediodía UTC → "mañana" en hora de Madrid es 2026-09-26
  r = cargar({
    ahoraUTC: '2026-09-25T12:00:00Z',
    hist: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00' }, { voluntario_id: 'a', fecha: '2026-09-27', rango: '08:00 a 10:00' }],
    vols: [{ id: 'a', nombre: 'ANA PRUEBA', email: 'ana@x.com', tiene_llave: true }],
  });
  await llamar(r.handler, 'sec');
  check('solo entra el turno de mañana (26/09), no el de pasado mañana (27/09)',
    r.correos.length === 1 && /10:00 a 12:00/.test(r.correos[0].html) && !/08:00 a 10:00/.test(r.correos[0].html));
  check('portador de llave → el correo lo recuerda', /Eres portador de llave/.test(r.correos[0].html));
  check('lleva el enlace al cuestionario de fin de turno', /href="https:\/\/forms\.gle\/CGyhjDJheehep5rNA"/.test(r.correos[0].html) && /forms\.gle/.test(r.correos[0].text));
  check('versión en texto plano con el turno en lista y la nota de no responder',
    !/<[a-z/]/i.test(r.correos[0].text) && /10:00 a 12:00/.test(r.correos[0].text) && /Sábado 26\/09\/2026/.test(r.correos[0].text) && /no es necesario responder/.test(r.correos[0].text));
  check('se anota en recordatorios_enviados para no duplicar', r.insertados.some(i => i.t === 'recordatorios_enviados' && i.fila.clave === 'a|2026-09-26'));

  r = cargar({
    ahoraUTC: '2026-09-25T12:00:00Z',
    hist: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00' }],
    vols: [{ id: 'a', nombre: 'ANA', email: 'ana@x.com', tiene_llave: false }],
    yaEnviados: ['a|2026-09-26'],
  });
  await llamar(r.handler, 'sec');
  check('si ya se avisó hoy, no se repite', r.correos.length === 0);

  r = cargar({
    ahoraUTC: '2026-09-25T12:00:00Z',
    hist: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00' }],
    vols: [{ id: 'a', nombre: 'ANA', email: null, tiene_llave: false }],
  });
  await llamar(r.handler, 'sec');
  check('sin email guardado → no se manda nada', r.correos.length === 0);

  // Compañeros del turno: misma franja, sin uno mismo, 🔑 a quien tiene llave; otra franja no cuenta
  const equipo = {
    ahoraUTC: '2026-09-25T12:00:00Z',
    hist: [
      { voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00' },
      { voluntario_id: 'b', fecha: '2026-09-26', rango: '10:00 a 12:00' },
      { voluntario_id: 'c', fecha: '2026-09-26', rango: '10:00 a 12:00' },
      { voluntario_id: 'd', fecha: '2026-09-26', rango: '16:00 a 18:00' },
      { voluntario_id: 'a', fecha: '2026-10-23', rango: '16:00 a 18:00' },
      { voluntario_id: 'b', fecha: '2026-10-23', rango: '16:00 a 18:00' },
    ],
    vols: [
      { id: 'a', nombre: 'ANA', email: 'ana@x.com', tiene_llave: false },
      { id: 'b', nombre: 'BEA', email: null, tiene_llave: true },
      { id: 'c', nombre: 'CARLOS', email: null, tiene_llave: false },
      { id: 'd', nombre: 'DANI', email: null, tiene_llave: false },
    ],
  };
  r = cargar(equipo);
  await llamar(r.handler, 'sec');
  check('lista los compañeros de la franja con 🔑 al que tiene llave (sin uno mismo ni otras franjas)',
    r.correos.length === 1 && /BEA 🔑/.test(r.correos[0].html) && /CARLOS/.test(r.correos[0].html)
    && !/DANI/.test(r.correos[0].html) && (r.correos[0].html.match(/ANA/g) || []).length === 1 && !/Eres portador/.test(r.correos[0].html));

  r = cargar(equipo);
  const pr = await llamar(r.handler, 'sec', { prueba_voluntario_id: 'a' });
  check('modo prueba → próximo turno, asunto [PRUEBA], sin anotar en recordatorios_enviados',
    pr.status === 200 && r.correos.length === 1 && /^\[PRUEBA\]/.test(r.correos[0].subject) && /26\/09\/2026/.test(r.correos[0].subject)
    && r.insertados.length === 0);

  r = cargar({ ...equipo, yaEnviados: ['a|2026-09-26'] });
  await llamar(r.handler, 'sec', { prueba_voluntario_id: 'a' });
  check('modo prueba ignora el "ya enviado" (se puede repetir)', r.correos.length === 1);

  r = cargar(equipo);
  const pr2 = await llamar(r.handler, null, { prueba_voluntario_id: 'a' });
  check('modo prueba sin secreto → 401', pr2.status === 401 && r.correos.length === 0);

  r = cargar(equipo);
  const pr3 = await llamar(r.handler, 'sec', { prueba_voluntario_id: 'b' });
  check('modo prueba con voluntario sin email → 400', pr3.status === 400 && r.correos.length === 0);

  // Bajas, apuntes y turnos anulados: mismo criterio que la app (equipo − bajas + apuntados)
  r = cargar({
    ...equipo,
    vols: equipo.vols.map(v => ({ ...v, email: v.id + '@x.com' })),
    bajas: [{ voluntario_id: 'c', fecha: '2026-09-26', rango: '10:00 a 12:00', activa: true }],
    refs: [{ voluntario_id: 'd', fecha: '2026-09-26', rango: '10:00 a 12:00', es_dia_completo: false }],
  });
  await llamar(r.handler, 'sec');
  const para = (id) => r.correos.find(c => c.to[0] === id + '@x.com');
  check('quien tiene baja no recibe recordatorio', !para('c'));
  check('quien tiene baja no sale como compañero', !/CARLOS/.test(para('a').html));
  check('quien se ha apuntado recibe recordatorio y sale como compañero', !!para('d') && /10:00 a 12:00/.test(para('d').html) && /DANI/.test(para('a').html));

  r = cargar({
    ...equipo,
    bajas: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00', activa: true }],
    refs: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00', es_dia_completo: false }],
  });
  await llamar(r.handler, 'sec');
  check('baja + apunte de la misma persona → se reincorpora (recibe recordatorio)', r.correos.length === 1);

  r = cargar({ ...equipo, bajas: [{ voluntario_id: 'a', fecha: '2026-09-26', rango: '10:00 a 12:00', activa: false }] });
  await llamar(r.handler, 'sec');
  check('baja anulada no cuenta (recibe recordatorio)', r.correos.length === 1);

  r = cargar({ ...equipo, anulados: [{ fecha: '2026-09-26', rango: '10:00 a 12:00' }] });
  await llamar(r.handler, 'sec');
  check('turno anulado a mano → sin recordatorio', r.correos.length === 0);

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})();
