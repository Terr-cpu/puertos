// ══════════════════════════════════════════════════════════════
//  idioma.js — selector Español / English para la entrada y el menú
//  ────────────────────────────────────────────────────────────
//  Cada página registra sus textos:
//    I18N.textos({ es: { clave: 'Hola' }, en: { clave: 'Hi' } });
//  y los marca en el HTML:
//    data-t="clave"          → textContent
//    data-t-html="clave"     → innerHTML (textos con <b>…)
//    data-t-ph="clave"       → placeholder
//  En el JavaScript: I18N.t('clave', { nombre: 'Ana' })  ("Hola, {nombre}")
//  Al cambiar de idioma se avisa con I18N.alCambiar(fn) para repintar lo dinámico.
//  La elección se guarda en el navegador; la primera vez, el idioma del teléfono.
// ══════════════════════════════════════════════════════════════
(function () {
  const IDIOMAS = ['es', 'en'];
  const dic = { es: {}, en: {} };
  const oyentes = [];

  function inicial() {
    try { const g = localStorage.getItem('idioma'); if (IDIOMAS.includes(g)) return g; } catch (e) {}
    return /^es\b/i.test(navigator.language || 'es') ? 'es' : 'en';
  }
  let actual = inicial();

  function t(clave, vars) {
    let s = dic[actual][clave] ?? dic.es[clave] ?? clave;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }

  function aplicar(raiz) {
    const r = raiz || document;
    document.documentElement.lang = actual;
    r.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    r.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.dataset.tHtml); });
    r.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
    if (dic[actual]._titulo) document.title = t('_titulo');
    document.querySelectorAll('.idioma-sel button').forEach(b => b.classList.toggle('on', b.dataset.idioma === actual));
  }

  function poner(id) {
    if (!IDIOMAS.includes(id) || id === actual) return;
    actual = id;
    try { localStorage.setItem('idioma', id); } catch (e) {}
    aplicar();
    oyentes.forEach(fn => { try { fn(id); } catch (e) { console.error(e); } });
  }

  /** Botones "ES · EN" (cristal sobre la cabecera azul). Se colocan en `donde`. */
  function selector(donde) {
    const css = document.createElement('style');
    css.textContent = `.idioma-sel{position:absolute;top:14px;right:14px;z-index:5;display:flex;gap:2px;padding:3px;border-radius:12px;
      background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
      .idioma-sel button{font:700 .68rem 'Sora',system-ui,sans-serif;letter-spacing:.06em;color:rgba(255,255,255,.65);background:none;
      border:none;border-radius:9px;padding:.32rem .6rem;cursor:pointer}
      .idioma-sel button.on{background:rgba(255,255,255,.92);color:#0a1628}`;
    document.head.appendChild(css);
    const d = document.createElement('div');
    d.className = 'idioma-sel';
    d.setAttribute('role', 'group');
    d.setAttribute('aria-label', 'Idioma / Language');
    d.innerHTML = '<button type="button" data-idioma="es" lang="es">ES</button><button type="button" data-idioma="en" lang="en">EN</button>';
    d.querySelectorAll('button').forEach(b => { b.onclick = () => poner(b.dataset.idioma); });
    donde.appendChild(d);
    aplicar();
  }

  window.I18N = {
    t, aplicar, poner, selector,
    get idioma() { return actual; },
    /** Fechas y números con el idioma elegido (es-ES / en-GB). */
    get locale() { return actual === 'es' ? 'es-ES' : 'en-GB'; },
    textos(o) { IDIOMAS.forEach(i => Object.assign(dic[i], o[i] || {})); },
    alCambiar(fn) { oyentes.push(fn); },
  };
})();
