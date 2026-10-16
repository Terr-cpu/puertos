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

  // "Mantener la sesión iniciada" (casilla del login): con ella la sesión se guarda en
  // localStorage y sigue abierta al volver; sin ella, en sessionStorage y se cierra al
  // cerrar el navegador. Por defecto, mantenerla.
  const recordar = () => { try { return localStorage.getItem('recordarme') !== '0'; } catch (e) { return true; } };
  const almacen = {
    getItem(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) {
      try {
        if (recordar()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
        else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
      } catch (e) { /* sin almacenamiento (modo privado): la sesión dura lo que la página */ }
    },
    removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} },
  };

  const sb = window.supabase.createClient(URL_SB, CLAVE_PUBLICA, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: almacen },
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

  /**
   * ¿Ha marcado ya su NUEVA disponibilidad (por bloques)? Lo primero que tiene que hacer un
   * voluntario la primera vez que entra. Cuenta como hecha si tiene guardado algún bloque de
   * disponibilidad-bloques.html (Mañana "08:00 a 14:00" / Tarde "16:00 a 22:00") o ha dicho
   * cuántos sábados/domingos puede: la disponibilidad antigua por horas no vale.
   * Si la consulta falla (sin red…), no se bloquea a nadie.
   */
  const BLOQUES_NUEVOS = ['08:00 a 14:00', '16:00 a 22:00'];
  async function disponibilidadHecha(yo) {
    const id = yo.voluntario.id;
    try { if (sessionStorage.getItem('dispoOk') === id) return true; } catch (e) {}
    try {
      const h = { apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + token };
      const enLista = BLOQUES_NUEVOS.map(b => '"' + b + '"').join(',');
      const [filas, ficha] = await Promise.all([
        fetch(URL_SB + '/rest/v1/disponibilidad?voluntario_id=eq.' + id + '&horario=in.(' + encodeURIComponent(enLista) + ')&select=id&limit=1', { headers: h }).then(r => r.ok ? r.json() : null),
        fetch(URL_SB + '/rest/v1/voluntarios?id=eq.' + id + '&select=max_sabados,max_domingos', { headers: h }).then(r => r.ok ? r.json() : null),
      ]);
      if (!filas || !ficha) return true;
      const ok = filas.length > 0 || !!(ficha[0] && (ficha[0].max_sabados || ficha[0].max_domingos));
      if (ok) { try { sessionStorage.setItem('dispoOk', id); } catch (e) {} }
      return ok;
    } catch (e) { return true; }
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

    /** Guarda la elección de la casilla "Mantener la sesión iniciada" (antes de entrar). */
    recordarSesion(si) { try { localStorage.setItem('recordarme', si ? '1' : '0'); } catch (e) {} },
    recordandoSesion: recordar,

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
      // Primera vez: antes que nada, marcar la nueva disponibilidad (y luego seguir a donde iba)
      if (rol === 'voluntario' && !yo.esAdmin && !/disponibilidad-bloques\.html$/.test(location.pathname)
          && !(await disponibilidadHecha(yo))) {
        location.replace('disponibilidad-bloques.html?primera=1&volver=' + encodeURIComponent(paginaActual()));
        return new Promise(() => {});
      }
      document.documentElement.classList.remove('auth-pendiente');
      return yo;
    },

    /**
     * ¿Actúa como él mismo? Siempre el voluntario; el admin, si tiene ficha y no ha elegido
     * "en nombre de otro voluntario" (botón de la barra; se recuerda en esta pestaña).
     */
    comoYo(yo) {
      if (!yo.voluntario) return false;
      if (!yo.esAdmin) return true;
      try { return sessionStorage.getItem('admin_otro') !== '1'; } catch (e) { return true; }
    },

    /** Tras guardar la disponibilidad nueva: ya no se vuelve a pedir en esta sesión. */
    disponibilidadMarcada() { try { if (Auth.yo?.voluntario) sessionStorage.setItem('dispoOk', Auth.yo.voluntario.id); } catch (e) {} },

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
      const yoMismo = Auth.comoYo(yo);
      // Admin con ficha: enlace a su panel y botón para alternar entre él mismo y "otro voluntario"
      const alternar = yo.esAdmin && yo.voluntario
        ? `<button type="button" class="alt">${yoMismo ? '👥 En nombre de otro' : '🙋 Volver a mí'}</button>` : '';
      b.innerHTML = `<a href="${yo.esAdmin ? 'planificador.html' : 'inicio.html'}">← ${yo.esAdmin ? 'Planificador' : 'Menú'}</a>
        ${yo.esAdmin && yo.voluntario ? '<a href="inicio.html">Mi panel</a>' : ''}
        <span>${(yoMismo ? yo.voluntario.nombre : yo.esAdmin ? 'Admin · cualquier voluntario' : yo.email).replace(/[<>&]/g, '')}</span>
        ${alternar}<button type="button" class="salir">Salir</button>`;
      b.querySelector('.salir').onclick = () => Auth.salir();
      const alt = b.querySelector('.alt');
      if (alt) alt.onclick = () => {
        try { sessionStorage.setItem('admin_otro', yoMismo ? '1' : '0'); } catch (e) {}
        location.reload();
      };
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
