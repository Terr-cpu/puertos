// Prueba de supabase/functions/notificar-email/index.ts
// Carga el archivo tal cual con Supabase y Resend simulados y ejercita cada
// tipo de evento de "actividad" más el modo directo de disponibilidad guardada.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'notificar-email', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ email = null, tieneLlave = false, usuario = { email: 'g@x.com', app_metadata: {} } } = {}) {
  const codigo = stripTypeScriptTypes(fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, ''));
  const correos = [];
  const sb = { from(t) {
    const q = { t };
    const b = { select() { return b; }, eq() { return b; }, limit() { return b; },
      then(ok, ko) {
        const data = t === 'voluntarios' ? [{ email, tiene_llave: tieneLlave }] : [];
        return Promise.resolve({ data, error: null }).then(ok, ko);
      } };
    return b;
  },
  auth: { getUser: async (tk) => (tk === 'tok' && usuario ? { data: { user: usuario }, error: null } : { data: { user: null }, error: { message: 'jwt' } }) },
  };
  let handler = null;
  const env = { RESEND_API_KEY: 'k', RESEND_FROM: 'Turnos <a@x.com>', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const ctx = {
    console, Date, Math, JSON, Promise, Error, Intl, Response, String,
    createClient: () => sb,
    Deno: { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } },
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; },
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { handler, correos };
}
const post = (h, body, token = 'tok') => h(new Request('http://x/', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) }));
const F = '2026-09-26', R = '10:00 a 12:00';

(async () => {
  console.log('\n═══ notificar-email — avisos a voluntarios ═══');

  let r = cargar({ email: 'ana@x.com' });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'baja', voluntario_id: 'a', nombre: 'ANA PRUEBA', fecha: F, rango: R } });
  check('baja → correo con "Baja registrada"', r.correos.length === 1 && r.correos[0].to[0] === 'ana@x.com' && /Baja registrada/.test(r.correos[0].subject));

  r = cargar({ email: null });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'baja', voluntario_id: 'a', nombre: 'ANA', fecha: F, rango: R } });
  check('baja sin email guardado → no se manda nada', r.correos.length === 0);

  r = cargar({ email: 'c@x.com', tieneLlave: true });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'equipo_anadido', voluntario_id: 'a', nombre: 'CARLOS', fecha: F, rango: R } });
  check('equipo_anadido (portador de llave) → correo con nota de llave y enlace al cuestionario', /forms\.gle/.test(r.correos[0].html) && r.correos.length === 1 && /Turno confirmado/.test(r.correos[0].subject) && /llave/i.test(r.correos[0].html));

  r = cargar({ email: 'd@x.com', tieneLlave: false });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'equipo_anadido', voluntario_id: 'a', nombre: 'DANI', fecha: F, rango: R } });
  check('equipo_anadido (sin llave) → correo sin nota de llave', r.correos.length === 1 && !/llave/i.test(r.correos[0].html));

  r = cargar({ email: 'e@x.com' });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'equipo_quitado', voluntario_id: 'a', nombre: 'ELENA', fecha: F, rango: R } });
  check('equipo_quitado → correo "Cambios en tu turno" con el contacto de Manuel Fernández', /hermano <b[^>]*>Manuel Fernández<\/b>/.test(r.correos[0].html) && !/coordinador/.test(r.correos[0].html) && r.correos.length === 1 && /Cambios en tu turno/.test(r.correos[0].subject));

  r = cargar({ email: 'f@x.com' });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'apunte', voluntario_id: 'a', nombre: 'F', fecha: F, rango: R } });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'apunte_cancelado', voluntario_id: 'a', nombre: 'F', fecha: F, rango: R } });
  await post(r.handler, { type: 'INSERT', table: 'actividad', record: { tipo: 'baja_anulada', voluntario_id: 'a', nombre: 'F', fecha: F, rango: R } });
  check('apunte / apunte_cancelado / baja_anulada → ningún correo (ya avisan por Telegram)', r.correos.length === 0);

  r = cargar({ email: 'g@x.com' });
  await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'GIOVANNI', resumenTexto: 'Sábado: Mañana, Tarde (máx. 3/mes)' });
  check('disponibilidad_guardada con email → correo recibo con el resumen', r.correos.length === 1 && /Disponibilidad guardada/.test(r.correos[0].subject) && /máx\. 3\/mes/.test(r.correos[0].html));
  check('versión en texto plano: sin etiquetas, con el resumen y la nota de no responder',
    typeof r.correos[0].text === 'string' && !/<[a-z/]/i.test(r.correos[0].text) && /máx\. 3\/mes/.test(r.correos[0].text) && /no es necesario responder/.test(r.correos[0].text));

  r = cargar({ email: null });
  await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'H', resumenTexto: 'x' });
  check('disponibilidad_guardada sin email → no se manda nada', r.correos.length === 0);

  // El recibo solo lo puede pedir el propio voluntario (o el admin)
  r = cargar({ email: 'g@x.com', usuario: { email: 'otro@x.com', app_metadata: {} } });
  let rr = await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'G', resumenTexto: 'x' });
  check('recibo pedido por otro usuario → 403 y no se manda', rr.status === 403 && r.correos.length === 0);
  r = cargar({ email: 'g@x.com' });
  rr = await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'G', resumenTexto: 'x' }, null);
  check('recibo sin sesión → 403', rr.status === 403 && r.correos.length === 0);
  r = cargar({ email: 'g@x.com', usuario: { email: 'admin@x.com', app_metadata: { rol: 'admin' } } });
  await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'G', resumenTexto: 'x' });
  check('recibo pedido por el admin → se manda', r.correos.length === 1);
  r = cargar({ email: 'G@X.com ' });
  await post(r.handler, { accion: 'disponibilidad_guardada', voluntario_id: 'a', nombre: 'G', resumenTexto: 'x' });
  check('el correo de la ficha se compara sin mayúsculas ni espacios', r.correos.length === 1);

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})();
