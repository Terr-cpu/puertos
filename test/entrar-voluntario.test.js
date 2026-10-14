// Prueba de supabase/functions/entrar-voluntario/index.ts
// Carga el archivo tal cual con Supabase (tabla voluntarios y API de admin de Auth) simulado.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'entrar-voluntario', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ vols = [], usuarios = {} } = {}) {
  const codigo = stripTypeScriptTypes(fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, ''));
  const altas = [], enlaces = [];
  const sb = {
    from() {
      const q = {};
      const b = {
        select() { return b; },
        ilike(c, v) { q.v = v; return b; },
        then(ok, ko) {
          const data = vols.filter(x => x.email && x.email.trim().toLowerCase() === q.v);
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return b;
    },
    auth: { admin: {
      async createUser({ email }) {
        if (usuarios[email]) return { data: null, error: { message: 'A user with this email address has already been registered' } };
        usuarios[email] = { email, app_metadata: {} }; altas.push(email);
        return { data: { user: usuarios[email] }, error: null };
      },
      async generateLink({ email }) {
        enlaces.push(email);
        return { data: { user: usuarios[email], properties: { hashed_token: 'hash-' + email } }, error: null };
      },
    } },
  };
  let handler = null;
  const ctx = {
    console, JSON, Promise, Error, Response, String,
    createClient: () => sb,
    Deno: { env: { get: () => 'x' }, serve: (fn) => { handler = fn; } },
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { handler, altas, enlaces, usuarios };
}
const pedir = async (h, body) => {
  const r = await h(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, cuerpo: JSON.parse(await r.text()), cors: r.headers.get('Access-Control-Allow-Origin') };
};

(async () => {
  console.log('\n═══ entrar-voluntario — acceso solo con el correo ═══');
  const vols = [
    { email: 'Ana@X.com ', activo: true },
    { email: 'baja@x.com', activo: false },
    { email: 'manuf.m@hotmail.com', activo: true },
  ];

  let r = cargar({ vols });
  let res = await pedir(r.handler, { email: '  ana@x.COM ' });
  check('correo de una ficha activa → token (sin importar mayúsculas ni espacios)', res.status === 200 && res.cuerpo.token_hash === 'hash-ana@x.com');
  check('la primera vez crea la cuenta', r.altas.length === 1 && r.altas[0] === 'ana@x.com');
  check('lleva CORS', res.cors === '*');

  res = await pedir(r.handler, { email: 'ana@x.com' });
  check('la segunda vez no la vuelve a crear y entra igual', res.status === 200 && r.altas.length === 1);

  r = cargar({ vols });
  res = await pedir(r.handler, { email: 'nadie@x.com' });
  check('correo que no está en ninguna ficha → sin_ficha, no crea cuenta', res.status === 404 && res.cuerpo.error === 'sin_ficha' && r.altas.length === 0);

  res = await pedir(r.handler, { email: 'baja@x.com' });
  check('ficha inactiva → sin_ficha', res.status === 404 && res.cuerpo.error === 'sin_ficha');

  res = await pedir(r.handler, { email: 'no-es-correo' });
  check('texto que no es un correo → 400', res.status === 400);

  r = cargar({ vols: [{ email: 'a_b@x.com', activo: true }] });
  res = await pedir(r.handler, { email: 'axb@x.com' });
  check('un "_" del correo no hace de comodín', res.status === 404);

  r = cargar({ vols, usuarios: { 'manuf.m@hotmail.com': { email: 'manuf.m@hotmail.com', app_metadata: { rol: 'admin' } } } });
  res = await pedir(r.handler, { email: 'manuf.m@hotmail.com' });
  check('cuenta de admin → rechazada (solo entra con contraseña) y sin token', res.status === 403 && res.cuerpo.error === 'admin' && !res.cuerpo.token_hash);

  r = cargar();
  const pre = await r.handler(new Request('http://x/', { method: 'OPTIONS' }));
  check('OPTIONS (preflight del navegador) → 200', pre.status === 200);

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})();
