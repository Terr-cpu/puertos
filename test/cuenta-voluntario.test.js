// Prueba de supabase/functions/cuenta-voluntario/index.ts
// Carga el archivo tal cual con Supabase (tabla voluntarios y API de admin de Auth) simulado.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'cuenta-voluntario', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ vols = [], usuarios = [] } = {}) {
  const codigo = stripTypeScriptTypes(fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, ''));
  const altas = [];
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
      async listUsers({ page }) { return { data: { users: page === 1 ? usuarios.map(e => ({ email: e })) : [] }, error: null }; },
      async createUser({ email, password, email_confirm }) {
        if (usuarios.includes(email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
        usuarios.push(email); altas.push({ email, password, email_confirm });
        return { data: { user: { email } }, error: null };
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
  return { handler, altas };
}
const pedir = async (h, body) => {
  const r = await h(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, cuerpo: JSON.parse(await r.text()), cors: r.headers.get('Access-Control-Allow-Origin') };
};

(async () => {
  console.log('\n═══ cuenta-voluntario — primera vez y estado de la cuenta ═══');
  const vols = [
    { email: 'Ana@X.com ', activo: true },
    { email: 'luis@x.com', activo: true },
    { email: 'baja@x.com', activo: false },
  ];

  let r = cargar({ vols, usuarios: ['luis@x.com'] });
  let res = await pedir(r.handler, { accion: 'estado', email: '  ana@x.COM ' });
  check('ficha sin cuenta → "nueva" (sin importar mayúsculas ni espacios)', res.status === 200 && res.cuerpo.estado === 'nueva');
  check('lleva CORS', res.cors === '*');
  res = await pedir(r.handler, { accion: 'estado', email: 'luis@x.com' });
  check('ficha con cuenta → "existente"', res.cuerpo.estado === 'existente');
  res = await pedir(r.handler, { accion: 'estado', email: 'nadie@x.com' });
  check('correo sin ficha → "sin_ficha"', res.cuerpo.estado === 'sin_ficha');
  res = await pedir(r.handler, { accion: 'estado', email: 'baja@x.com' });
  check('ficha inactiva → "sin_ficha"', res.cuerpo.estado === 'sin_ficha');
  res = await pedir(r.handler, { accion: 'estado', email: 'no-es-correo' });
  check('texto que no es un correo → 400', res.status === 400);

  res = await pedir(r.handler, { accion: 'crear', email: 'ana@x.com', password: 'secreta123' });
  check('crear con ficha y sin cuenta → ok, cuenta ya confirmada', res.status === 200 && res.cuerpo.ok && r.altas.length === 1 && r.altas[0].email_confirm === true && r.altas[0].password === 'secreta123');
  res = await pedir(r.handler, { accion: 'estado', email: 'ana@x.com' });
  check('después de crearla ya es "existente"', res.cuerpo.estado === 'existente');
  res = await pedir(r.handler, { accion: 'crear', email: 'ana@x.com', password: 'otraclave99' });
  check('crear otra vez la misma (cambiar la contraseña de otro) → "existente", no se toca', res.status === 409 && res.cuerpo.error === 'existente' && r.altas.length === 1);

  res = await pedir(r.handler, { accion: 'crear', email: 'nadie@x.com', password: 'secreta123' });
  check('crear sin ficha → sin_ficha, no crea nada', res.status === 404 && r.altas.length === 1);
  res = await pedir(r.handler, { accion: 'crear', email: 'luis@x.com', password: '123' });
  check('contraseña corta → clave_corta', res.status === 400 && res.cuerpo.error === 'clave_corta');

  r = cargar({ vols: [{ email: 'a_b@x.com', activo: true }] });
  res = await pedir(r.handler, { accion: 'estado', email: 'axb@x.com' });
  check('un "_" del correo no hace de comodín', res.cuerpo.estado === 'sin_ficha');

  const pre = await r.handler(new Request('http://x/', { method: 'OPTIONS' }));
  check('OPTIONS (preflight del navegador) → 200', pre.status === 200);

  console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
})();
