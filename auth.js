// ══════════════════════════════════════════════════════════════
//  auth.js — sesión compartida por todas las páginas (Supabase Auth)
//  ────────────────────────────────────────────────────────────
//  Cada página lo carga en el <head>, justo después de supabase-js:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
//    <script src="auth.js"></script>
//  y antes de pedir datos espera a:
//    const yo = await Auth.requerir('admin');      // planificador
//    const yo = await Auth.requerir('voluntario'); // sustituciones, disponibilidad, inicio
//  → { email, esAdmin, voluntario: {id, nombre, tiene_llave} | null }
//  Sin sesión, lleva al login (index.html) y vuelve aquí al entrar.
//
//  Quién es admin lo dice app_metadata.rol = 'admin' (solo se puede poner desde
//  Supabase, ver supabase/13_login.sql); el voluntario se reconoce por el correo
//  de su ficha (voluntarios.email).
//
//  Las peticiones a Supabase deben llevar el token del usuario, no la clave
//  pública: Auth.token() devuelve el vigente (supabase-js lo renueva solo).
// ══════════════════════════════════════════════════════════════
(function () {
  const URL_SB = 'https://inifdflvblnonzowbxie.supabase.co';
  const CLAVE_PUBLICA = 'sb_publishable_2PIBcSVgX-8gtQRLPILJlQ_AyCq3cIH';

  // La página no se ve hasta saber quién es (evita enseñar el planificador un instante)
  document.documentElement.classList.add('auth-pendiente');
  const st = document.createElement('style');
  st.textContent = 'html.auth-pendiente body{visibility:hidden}';
  document.head.appendChild(st);

  const sb = window.supabase.createClient(URL_SB, CLAVE_PUBLICA, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let token = null;
  sb.auth.onAuthStateChange((evento, sesion) => {
    token = sesion?.access_token || null;
    if (evento === 'SIGNED_OUT' && !location.pathname.endsWith('/index.html') && !/\/$/.test(location.pathname)) irAlLogin();
  });

  function paginaActual() {
    return (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
  }
  function irAlLogin(msg) {
    const q = new URLSearchParams({ volver: paginaActual() });
    if (msg) q.set('msg', msg);
    location.replace('index.html?' + q.toString());
  }

  /** Perfil del usuario con sesión: admin y/o voluntario (por el correo de su ficha). */
  async function perfil(sesion) {
    const esAdminJwt = sesion.user?.app_metadata?.rol === 'admin';
    let voluntario = null;
    try {
      const r = await fetch(URL_SB + '/rest/v1/rpc/mi_perfil', {
        method: 'POST',
        headers: { apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + sesion.access_token, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (r.ok) voluntario = (await r.json())?.voluntario || null;
    } catch (e) { /* sin red: se decide solo con el JWT */ }
    return { email: sesion.user?.email || '', esAdmin: esAdminJwt, voluntario };
  }

  const Auth = {
    sb,
    URL: URL_SB,
    CLAVE: CLAVE_PUBLICA,
    yo: null,

    /** Token vigente para "Authorization: Bearer …" (la clave pública si aún no hay sesión). */
    token() { return token || CLAVE_PUBLICA; },

    /** Cabeceras para la API REST de Supabase, siempre con el token vigente. */
    cabeceras(extra) {
      return Object.assign({ apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + Auth.token(),
        'Content-Type': 'application/json', Accept: 'application/json' }, extra || {});
    },

    /** Sesión y perfil actuales, o null si no hay sesión. No redirige. */
    async actual() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      token = data.session.access_token;
      return (Auth.yo = await perfil(data.session));
    },

    /**
     * Exige sesión. rol: 'admin' (solo el coordinador) o 'voluntario' (voluntario con ficha,
     * o el admin). Si no cumple, redirige y la promesa no se resuelve nunca.
     */
    async requerir(rol) {
      const yo = await Auth.actual();
      if (!yo) { irAlLogin(); return new Promise(() => {}); }
      if (rol === 'admin' && !yo.esAdmin) { location.replace(yo.voluntario ? 'inicio.html' : 'index.html'); return new Promise(() => {}); }
      if (rol === 'voluntario' && !yo.esAdmin && !yo.voluntario) {
        await sb.auth.signOut();
        irAlLogin('sin-ficha');
        return new Promise(() => {});
      }
      document.documentElement.classList.remove('auth-pendiente');
      return yo;
    },

    async salir() {
      await sb.auth.signOut();
      location.replace('index.html');
    },

    /**
     * Barra fina arriba para las páginas del voluntario: "← Menú" y "Salir".
     * Al admin le lleva al planificador en vez de al menú.
     */
    barra(yo) {
      const b = document.createElement('div');
      b.className = 'auth-barra';
      b.innerHTML = `<a href="${yo.esAdmin ? 'planificador.html' : 'inicio.html'}">← ${yo.esAdmin ? 'Planificador' : 'Menú'}</a>
        <span>${(yo.voluntario?.nombre || yo.email).replace(/[<>&]/g, '')}</span>
        <button type="button">Salir</button>`;
      b.querySelector('button').onclick = () => Auth.salir();
      const css = document.createElement('style');
      css.textContent = `.auth-barra{display:flex;align-items:center;gap:.75rem;background:#0a1628;color:rgba(255,255,255,.7);
        padding:.45rem 1rem;font:600 .74rem 'Sora',system-ui,sans-serif;border-bottom:1px solid rgba(255,255,255,.08)}
        .auth-barra a{color:#fff;text-decoration:none}.auth-barra span{flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .auth-barra button{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;
        padding:.22rem .65rem;font:inherit;cursor:pointer}`;
      document.head.appendChild(css);
      document.body.insertBefore(b, document.body.firstChild);
    },
  };

  window.Auth = Auth;
})();
