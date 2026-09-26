// Harness de prueba del motor de planificación de planificador.html
// Extrae el <script>, lo evalúa con un DOM/localStorage simulado y ejercita
// planificarMesGlobal() con escenarios sintéticos.
const fs = require('fs');
const path = require('path');

// Subir directorios hasta encontrar planificador.html (repo raíz)
function findHtml() {
  const cands = [process.cwd()];
  let dir = __dirname;
  for (let i = 0; i < 12; i++) { cands.push(dir); dir = path.dirname(dir); }
  for (const d of cands) {
    const p = path.join(d, 'planificador.html');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('no encuentro planificador.html');
}
const html = findHtml();
let body = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
// Quitar el bloque INIT final (efectos de arranque)
body = body.replace(/\/\/ ── INIT[\s\S]*$/, '');
body += '\n;globalThis.__engine = { planificarMesGlobal, calcularDiaJS, _evModelo, _fichaModelo, _stPeriodo, _stEstadoMes, _impParsearLinea, _impParsear, _impEmparejar, _impPlan, _tgTexto, _tgParsearTexto, _tgParsear, _tgConsolidar, _tgPlan, _dispoModelo, _dispoHoras, _dSemTxt, _dResumenLineas, _stDispoStrip, _impSegmentar, _impSugerir, _impEsPrograma, _impParsearPrograma, _impFusionar, _stApuntesGlobal, _statsBase, _statsAgregar, _statsInsights, PH, HP, franjas2h, normDia, cargarReglas, reglasLlaveConf };\n';

// ── Stubs de entorno ──
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const noopEl = new Proxy({}, {
  get: (t, p) => {
    if (p === 'style') return {};
    if (p === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){return false;} };
    if (p === 'appendChild' || p === 'insertAdjacentHTML' || p === 'addEventListener' || p === 'setAttribute') return () => {};
    if (p === 'querySelectorAll' || p === 'querySelector') return () => (p.endsWith('All') ? [] : noopEl);
    return '';
  },
  set: () => true,
});
const documentStub = {
  getElementById: () => noopEl,
  querySelector: () => noopEl,
  querySelectorAll: () => [],
  createElement: () => noopEl,
  addEventListener: () => {},
  body: noopEl,
};
const windowStub = { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener(){} }) };
const fetchStub = async () => ({ ok: true, json: async () => ({}), text: async () => '' });

function Obs(){ this.observe = () => {}; this.disconnect = () => {}; this.takeRecords = () => []; }
const ctx = {
  console, Date, Math, JSON, Set, Map, Array, Object, String, Number, isNaN, parseInt, parseFloat,
  RegExp, Boolean, Error, Promise, Symbol, encodeURIComponent, decodeURIComponent, isFinite,
  setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
  requestAnimationFrame: () => {}, cancelAnimationFrame: () => {},
  MutationObserver: Obs, IntersectionObserver: Obs, ResizeObserver: Obs,
  localStorage, document: documentStub, window: windowStub, navigator: { userAgent: 'node' },
  location: { href: 'http://x/', origin: 'http://x', search: '' },
  URL: { createObjectURL: () => '' }, Blob: function(){}, fetch: fetchStub, Notification: function(){},
  crypto: { randomUUID: () => 'xxxx', getRandomValues: a => a },
  globalThis: {},
};
ctx.window = Object.assign(ctx.window, { localStorage, document: documentStub });
const vm = require('vm');
vm.createContext(ctx);
new vm.Script(body).runInContext(ctx);
const E = ctx.globalThis.__engine;
if (!E || !E.planificarMesGlobal) throw new Error('no se expuso el motor');

// ══════════════════════════════════════════════════════════════
//  Utilidades para construir escenarios
// ══════════════════════════════════════════════════════════════
const DAY = 86400000;
function tsDe(fiso) { return new Date(fiso + 'T12:00:00Z').getTime(); }
function diaSemanaNombre(fiso) {
  return ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'][new Date(fiso + 'T12:00:00Z').getUTCDay()];
}
function semanaDe(fiso) { const d = +fiso.split('-')[2]; return d<=7?1:d<=14?2:d<=21?3:d<=28?4:5; }

// vols: [{nombre, llave}]  disp: { 'YYYY-MM-DD': ['NOMBRE 10 a 20', ...] } o func
function construir({ dias, vols, dispPorDia, histReal = [], turnosHab = {}, reglas = {} }) {
  const llaves = new Set(vols.filter(v => v.llave).map(v => v.nombre.toUpperCase()));
  const R = { ...E.cargarReglas(), ...reglas };
  const histFlat = histReal.map(h => ({ key: h.nombre.toUpperCase(), ts: tsDe(h.fecha) }));
  // dispoIdx: 'semana|Dia' -> [{nombre, llave, horario}]
  const dispoIdx = {};
  const diasPendientes = dias.map(fiso => {
    const dnorm = diaSemanaNombre(fiso);
    const sem = semanaDe(fiso);
    const k = sem + '|' + dnorm;
    const lista = (dispPorDia[fiso] || []).map(s => {
      const m = s.match(/^(.+?)\s+(\d+)\s+a\s+(\d+)$/);
      const nombre = m[1].trim();
      return { nombre, llave: llaves.has(nombre.toUpperCase()), horario: `${m[2]}:00 a ${m[3]}:00` };
    });
    dispoIdx[k] = (dispoIdx[k] || []).concat(lista);
    return {
      dia: { fechaISO: fiso, fecha: fiso, dia: dnorm, semana: sem, turnos: turnosHab[fiso] || [] },
      fiso, ts: tsDe(fiso), semana: sem, diaNorm: dnorm,
      turnosHabilitados: turnosHab[fiso] || [], exc: {},
    };
  });
  return { diasPendientes, histFlat, dispoIdx, llaves, R };
}

function resumen(mapa, diasPendientes) {
  const out = [];
  for (const dp of diasPendientes) {
    const r = mapa.get(dp.fiso);
    const ts = r.turnos.map(t => {
      const eq = t.equipo.map(e => e.nombre + (e.llave ? '🔑' : '') + `(${e.dias}d)`).join(', ');
      const flags = [t.necesitaLlave ? 'necLlave' : '', t.alertaLlave ? 'ALERTA-LLAVE' : '', t.sinLlave ? 'SIN-LLAVE' : ''].filter(Boolean).join(' ');
      return `    ${t.rango} [${t.equipo.length}] ${eq} ${flags}`;
    }).join('\n');
    out.push(`  ${dp.fiso} ${dp.diaNorm} — ${r.turnos.length} turno(s)${r.diagnostico.aviso ? '  ' + r.diagnostico.aviso : ''}\n${ts || '    (sin turnos)'}`);
  }
  return out.join('\n');
}

// ══════════════════════════════════════════════════════════════
//  ESCENARIOS
// ══════════════════════════════════════════════════════════════
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

// ── E1: reparto de cobertura — lunes con mucha gente, martes escaso ──
(function E1() {
  console.log('\n═══ E1 · Reparto: NO quemar el lunes y dejar el martes sin turno ═══');
  const A = ['ANA','LUIS','MARThA','JOSE','PILAR','ROSA','IVAN','NOE','LOLA','RAUL','CARL','MARI'].map(n => ({ nombre: n, llave: ['ANA','JOSE','IVAN'].includes(n) }));
  const lun = '2026-10-05', mar = '2026-10-06';
  // Lunes: 11 disponibles 8-20. Martes: solo 4 disponibles, y 3 de ellos también el lunes.
  const disp = {
    [lun]: A.slice(0,11).map(v => `${v.nombre} 8 a 20`),
    [mar]: ['ANA 8 a 20','LUIS 8 a 20','MARThA 8 a 20','ROSA 8 a 20'],
  };
  const cfg = construir({ dias: [lun, mar], vols: A, dispPorDia: disp, reglas: { MAX_TURNOS_DIA: 3 } });
  const res = E.planificarMesGlobal({ diasPendientes: cfg.diasPendientes, histFlat: cfg.histFlat, dispoIdx: cfg.dispoIdx, llaves: cfg.llaves, R: cfg.R });
  console.log(resumen(res, cfg.diasPendientes));
  const tMar = res.get(mar).turnos;
  const tLun = res.get(lun).turnos;
  check('el martes tiene al menos 1 turno', tMar.length >= 1);
  check('el martes llega al mínimo de equipo (3)', tMar[0] && tMar[0].equipo.length >= 3, tMar[0] ? tMar[0].equipo.length + ' pers.' : 'sin turno');
  // los 3 voluntarios compartidos no deberían estar TODOS gastados el lunes
  const lunNombres = new Set(tLun.flatMap(t => t.equipo.map(e => e.nombre)));
  const compartidosEnLunes = ['LUIS','MARThA','ROSA'].filter(n => lunNombres.has(n)).length;
  check('reserva voluntarios compartidos para el martes', compartidosEnLunes <= 1, compartidosEnLunes + ' de 3 compartidos usados el lunes');
})();

// ── E2: descanso — cascada 5→3, nunca por debajo de 3 ──
(function E2() {
  console.log('\n═══ E2 · Descanso: cascada 5→4→3, nunca <3 ═══');
  const V = ['A','B','C','D','E','F'].map(n => ({ nombre: n, llave: n === 'A' }));
  const d1 = '2026-11-02'; // lunes
  const d2 = '2026-11-05'; // jueves — a 3 días
  const disp = { [d1]: V.map(v => `${v.nombre} 8 a 14`), [d2]: V.map(v => `${v.nombre} 8 a 14`) };
  const cfg = construir({ dias: [d1, d2], vols: V, dispPorDia: disp });
  const res = E.planificarMesGlobal({ ...cfg, diasPendientes: cfg.diasPendientes });
  console.log(resumen(res, cfg.diasPendientes));
  const t2 = res.get(d2).turnos;
  check('el jueves (a 3 días) se cubre con descanso relajado', t2.length >= 1);
  if (t2.length) {
    const minDesc = Math.min(...t2.flatMap(t => t.equipo.map(e => e.dias)));
    check('ningún voluntario con <3 días de descanso', minDesc >= 3, 'min descanso asignado = ' + minDesc);
    check('aviso de descanso reducido presente', /reducido/i.test(res.get(d2).diagnostico.aviso), JSON.stringify(res.get(d2).diagnostico.aviso));
  }
})();

// ── E3: portador de llave — turno único necesita llave; si no hay, ALERTA ──
(function E3() {
  console.log('\n═══ E3 · Llave: turno único requiere portador ═══');
  const conLlave = ['A','B','C','D'].map(n => ({ nombre: n, llave: n === 'A' }));
  const sinLlave = ['A','B','C','D'].map(n => ({ nombre: n, llave: false }));
  const d = '2026-10-13';
  const disp = { [d]: ['A 10 a 14','B 10 a 14','C 10 a 14','D 10 a 14'] };
  for (const [etq, vols] of [['con portador', conLlave], ['sin portador', sinLlave]]) {
    const cfg = construir({ dias: [d], vols, dispPorDia: disp });
    const res = E.planificarMesGlobal({ ...cfg });
    const t = res.get(d).turnos;
    console.log('  ' + etq + ':');
    console.log(resumen(res, cfg.diasPendientes).split('\n').map(l => '  ' + l).join('\n'));
    if (etq === 'con portador') check('equipo incluye al portador A', t[0] && t[0].equipo.some(e => e.nombre === 'A' && e.llave));
    else check('marca alerta de llave cuando no hay portador', t[0] && (t[0].alertaLlave || t[0].sinLlave));
  }
})();

// ── E4: balance de carga — ventana limita el histórico ──
(function E4() {
  console.log('\n═══ E4 · Balance: veterano fuera de ventana NO queda penalizado eternamente ═══');
  const V = ['VET','N1','N2','N3','N4'].map(n => ({ nombre: n, llave: n === 'VET' }));
  const d = '2026-12-07';
  // VET tiene 20 turnos hace 200 días (fuera de ventana 60) y ninguno reciente
  const hist = [];
  for (let i = 0; i < 20; i++) hist.push({ nombre: 'VET', fecha: '2026-05-01' });
  const disp = { [d]: V.map(v => `${v.nombre} 9 a 13`) };
  const cfg = construir({ dias: [d], vols: V, dispPorDia: disp, histReal: hist, reglas: { VENTANA_CARGA: 60 } });
  const res = E.planificarMesGlobal({ ...cfg });
  console.log(resumen(res, cfg.diasPendientes));
  const t = res.get(d).turnos[0];
  check('VET entra en el equipo (su carga vieja no cuenta)', t && t.equipo.some(e => e.nombre === 'VET'));
  check('carga en ventana de VET = 0', t && (t.equipo.find(e => e.nombre === 'VET')?.dispo === 0));
})();

// ── E5: turnos habilitados del calendario se respetan ──
(function E5() {
  console.log('\n═══ E5 · Solo se generan turnos en las franjas habilitadas ═══');
  const V = ['A','B','C','D','E'].map(n => ({ nombre: n, llave: n === 'A' }));
  const d = '2026-10-20';
  const disp = { [d]: V.map(v => `${v.nombre} 8 a 22`) };
  const cfg = construir({ dias: [d], vols: V, dispPorDia: disp, turnosHab: { [d]: ['16:00 a 18:00'] } });
  const res = E.planificarMesGlobal({ ...cfg });
  console.log(resumen(res, cfg.diasPendientes));
  const t = res.get(d).turnos;
  check('exactamente 1 turno', t.length === 1, t.length + '');
  check('el turno es 16:00 a 18:00', t[0] && t[0].rango === '16:00 a 18:00', t[0] && t[0].rango);
})();

// ── E6: robustez — día sin nadie disponible ──
(function E6() {
  console.log('\n═══ E6 · Día sin disponibilidad no rompe nada ═══');
  const V = [{ nombre: 'A', llave: true }];
  const d1 = '2026-10-26', d2 = '2026-10-27';
  const cfg = construir({ dias: [d1, d2], vols: V, dispPorDia: { [d1]: [], [d2]: [] } });
  let ok = true, res;
  try { res = E.planificarMesGlobal({ ...cfg }); } catch (e) { ok = false; console.log('  EXCEPCIÓN:', e.message); }
  check('no lanza excepción', ok);
  if (ok) check('ambos días sin turnos', res.get(d1).turnos.length === 0 && res.get(d2).turnos.length === 0);
})();

// ── E8: franjas habilitadas sin gente para todas — las que sobran deben
//        aparecer vacías (huecos), no desaparecer ──
(function E8() {
  console.log('\n═══ E8 · Franjas habilitadas de sobra: los huecos se muestran vacíos ═══');
  const V = ['ANA','LUIS','MARIA','JOSE'].map(n => ({ nombre: n, llave: n === 'ANA' }));
  const d = '2026-09-01';
  // Solo disponibles 11-13 (cubre un turno real); el resto de franjas habilitadas
  // (10-12,12-14,13-15,14-16,20-22) se quedan sin nadie.
  const disp = { [d]: ['ANA 11 a 13', 'LUIS 11 a 13', 'MARIA 11 a 13', 'JOSE 11 a 13'] };
  const hab = ['10:00 a 12:00', '11:00 a 13:00', '12:00 a 14:00', '13:00 a 15:00', '14:00 a 16:00', '20:00 a 22:00'];
  const cfg = construir({ dias: [d], vols: V, dispPorDia: disp, turnosHab: { [d]: hab } });
  const res = E.planificarMesGlobal({ ...cfg });
  const turnos = res.get(d).turnos;
  console.log(resumen(res, cfg.diasPendientes));
  check('el turno real 11:00-13:00 tiene equipo', turnos.some(t => t.rango === '11:00 a 13:00' && t.equipo.length === 4));
  check('se muestra un hueco vacío para el resto del día (13-15)', turnos.some(t => t.rango === '13:00 a 15:00' && t.equipo.length === 0));
  check('se muestra un hueco vacío para la tarde (20-22)', turnos.some(t => t.rango === '20:00 a 22:00' && t.equipo.length === 0));
  check('ningún turno se solapa en horas', (() => {
    const horas = turnos.map(t => parseInt(t.rango));
    for (let i = 0; i < turnos.length; i++) for (let j = i + 1; j < turnos.length; j++) {
      if (Math.abs(horas[i] - horas[j]) < 2) return false;
    }
    return true;
  })());
})();

// ── E7: escenario mensual grande — rendimiento y coherencia ──
(function E7() {
  console.log('\n═══ E7 · Mes completo (22 días, 30 voluntarios) — coherencia + tiempo ═══');
  const V = [];
  for (let i = 0; i < 30; i++) V.push({ nombre: 'V' + String(i).padStart(2, '0'), llave: i % 7 === 0 });
  const dias = [];
  for (let d = 1; d <= 30; d++) {
    const fiso = '2027-03-' + String(d).padStart(2, '0');
    const wd = new Date(fiso + 'T12:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue; // solo laborables
    dias.push(fiso);
  }
  const disp = {};
  dias.forEach((fiso, idx) => {
    // cada día ~10-16 disponibles pseudoaleatorios; algunos días “flojos”
    const n = (idx % 5 === 0) ? 6 : 10 + (idx % 7);
    disp[fiso] = [];
    for (let i = 0; i < n; i++) {
      const v = V[(idx * 3 + i * 7) % V.length];
      if (!disp[fiso].some(s => s.startsWith(v.nombre + ' '))) disp[fiso].push(`${v.nombre} 8 a 20`);
    }
  });
  const cfg = construir({ dias, vols: V, dispPorDia: disp, reglas: { MAX_TURNOS_DIA: 3 } });
  const t0 = Date.now();
  const res = E.planificarMesGlobal({ ...cfg });
  const ms = Date.now() - t0;
  let diasConTurno = 0, totalTurnos = 0, violDesc = 0, sobreMax = 0;
  const cargaPorVol = {};
  for (const dp of cfg.diasPendientes) {
    const r = res.get(dp.fiso);
    if (r.turnos.length) diasConTurno++;
    if (r.turnos.length > cfg.R.MAX_TURNOS_DIA) sobreMax++;
    totalTurnos += r.turnos.length;
    for (const t of r.turnos) for (const e of t.equipo) {
      if (e.dias < cfg.R.DESC_FLOOR) violDesc++;
      cargaPorVol[e.nombre] = (cargaPorVol[e.nombre] || 0) + 1;
    }
  }
  console.log(`  ${dias.length} días · ${diasConTurno} con turno · ${totalTurnos} turnos · ${ms}ms`);
  const cargas = Object.values(cargaPorVol);
  console.log(`  carga por voluntario: min ${Math.min(...cargas)} · max ${Math.max(...cargas)} · media ${(cargas.reduce((a,b)=>a+b,0)/cargas.length).toFixed(1)}`);
  check('tiempo < 1500ms', ms < 1500, ms + 'ms');
  check('cero violaciones del suelo de descanso', violDesc === 0, violDesc + '');
  check('ningún día supera MAX_TURNOS_DIA', sobreMax === 0);
  check('cubre la mayoría de días (>80%)', diasConTurno / dias.length > 0.8, (100*diasConTurno/dias.length).toFixed(0) + '%');
  check('reparto de carga razonable (max-min <= 4)', Math.max(...cargas) - Math.min(...cargas) <= 4, `spread ${Math.max(...cargas)-Math.min(...cargas)}`);
})();

// ── E9: vista En vivo — une equipo, bajas, apuntes y franjas habilitadas ──
(function E9() {
  console.log('\n═══ E9 · En vivo: modelo unificado de turnos/bajas/apuntes ═══');
  const hoy = '2026-10-05', f = '2026-10-07', f2 = '2026-10-08';
  const ahora = new Date().toISOString();
  const raw = {
    vols: [{ id:'a', nombre:'ANA' }, { id:'b', nombre:'BEA' }, { id:'c', nombre:'CARLOS' }, { id:'d', nombre:'DIEGO' }, { id:'e', nombre:'ELSA' }],
    hist: [
      { fecha:f, dia:'Miercoles', rango:'10:00 a 12:00', nombre:'ANA',   tiene_llave:true,  voluntario_id:'a', confirmado_en:ahora },
      { fecha:f, dia:'Miercoles', rango:'10:00 a 12:00', nombre:'BEA',   tiene_llave:false, voluntario_id:'b', confirmado_en:ahora },
      { fecha:f, dia:'Miercoles', rango:'10:00 a 12:00', nombre:'CARLOS',tiene_llave:false, voluntario_id:'c', confirmado_en:ahora },
      { fecha:f2, dia:'Jueves',   rango:'10:00 a 12:00', nombre:'DIEGO', tiene_llave:false, voluntario_id:'d', confirmado_en:ahora },
    ],
    bajas: [
      { voluntario_id:'a', fecha:f, dia:'Miercoles', rango:'10:00 a 12:00', registrado_en:ahora, activa:true },   // pierde la llave
      { voluntario_id:'d', fecha:f2, dia:'Jueves',   rango:'10:00 a 12:00', registrado_en:ahora, activa:true },
      { voluntario_id:'e', fecha:f2, dia:'Jueves',   rango:'10:00 a 12:00', registrado_en:ahora, activa:false },  // anulada: no cuenta
    ],
    refs: [
      { fecha:f2, dia:'Jueves', rango:'10:00 a 12:00', es_dia_completo:false, registrado_en:ahora, nombre:'DIEGO', tiene_llave:false, voluntario_id:'d' }, // reincorporación
      { fecha:f,  dia:'Miercoles', rango:'10:00 a 12:00', es_dia_completo:false, registrado_en:ahora, nombre:'ELSA', tiene_llave:false, voluntario_id:'e' },
      { fecha:f,  dia:'Miercoles', rango:null, es_dia_completo:true, registrado_en:ahora, nombre:'ELSA', tiene_llave:false, voluntario_id:'e' },
    ],
    cal: [
      { fecha:f, dia:'Miercoles', activo:true, navieras:['MSC','turno:10:00 a 12:00','turno:16:00 a 18:00','muelle:Delicias'] },
    ],
  };
  const M = E._evModelo(raw, hoy, { MIN_EQ:3, IDEAL:4 });
  const t1 = M.turnos.find(t => t.k === f + '|10:00 a 12:00');
  const t2 = M.turnos.find(t => t.k === f2 + '|10:00 a 12:00');
  const t3 = M.turnos.find(t => t.k === f + '|16:00 a 18:00');
  check('baja activa sale como chip "baja" y no cuenta como presente', t1.chips.find(c => c.id === 'a').tipo === 'baja');
  check('apunte de otra persona cubre la baja: BEA+CARLOS+ELSA = 3 → ok', t1.n === 3 && t1.estado === 'ok', 'n=' + t1.n);
  check('se detecta que el turno se quedó sin portador de llave', t1.sinLlave === true);
  check('baja + apunte de la misma persona = se reincorpora (cuenta)', t2.chips[0].tipo === 'vuelve' && t2.n === 1);
  check('un solo voluntario < MIN → falta 2 y nivel ámbar', t2.estado === 'falta' && t2.faltan === 2 && t2.nivel === 'ambar');
  check('la baja anulada (activa=false) se ignora', !t2.chips.some(c => c.id === 'e'));
  check('franja habilitada sin nadie aparece vacía y en rojo', t3 && t3.estado === 'vacio' && t3.nivel === 'rojo' && t3.abierto);
  check('el apunte de día completo no crea turno, va al día', !M.turnos.some(t => t.k === f + '|null') && M.dias.get(f).diaCompleto.length === 1);
  check('naviera del día sin prefijos turno:/muelle:', JSON.stringify(M.dias.get(f).navieras) === '["MSC"]');
  check('atención: sin llave (t1) + falta (t2) + vacío (t3) = 3', M.turnos.filter(t => t.atencion).length === 3, M.turnos.filter(t => t.atencion).length + '');
  check('hay eventos de baja, apunte que cubre, día completo y confirmación', ['baja','cubre','confirm','dia'].every(tp => M.eventos.some(e => e.tipo === tp)));
})();

// ── E10: eventos que vienen del registro de actividad (auditoría en la base de datos) ──
(function E10() {
  console.log('\n═══ E10 · En vivo: novedades desde la tabla actividad ═══');
  const ahora = new Date().toISOString();
  const raw = {
    vols: [{ id:'a', nombre:'ANA' }, { id:'b', nombre:'BEA' }],
    hist: [], bajas: [], cal: [],
    refs: [{ fecha:'2026-10-07', dia:'Miercoles', rango:'10:00 a 12:00', es_dia_completo:false, registrado_en:ahora, nombre:'BEA', tiene_llave:false, voluntario_id:'b' }],
    actividad: [
      { ts: ahora, tipo:'apunte_cancelado', voluntario_id:'a', nombre:'ANA', fecha:'2026-10-07', rango:'10:00 a 12:00' },
      { ts: ahora, tipo:'baja_anulada', voluntario_id:'b', nombre:'BEA', fecha:'2026-10-07', rango:'10:00 a 12:00' },   // BEA tiene apunte igual → reincorporación
      { ts: ahora, tipo:'baja_anulada', voluntario_id:'a', nombre:'ANA', fecha:'2026-10-09', rango:'10:00 a 12:00' },   // sin apunte → anulada a secas
      { ts: ahora, tipo:'equipo_quitado', voluntario_id:'a', nombre:'ANA', fecha:'2026-10-07', rango:'10:00 a 12:00' },
    ],
  };
  const M = E._evModelo(raw, '2026-10-05', { MIN_EQ:3, IDEAL:4 });
  const tipos = M.eventos.map(e => e.tipo);
  check('apunte cancelado → evento "cancel"', tipos.includes('cancel') && /canceló su apunte/.test(M.eventos.find(e => e.tipo === 'cancel').texto));
  check('baja anulada + apunte de la misma persona → "se reincorporó"', M.eventos.some(e => e.tipo === 'anulada' && /BEA<\/b> se reincorporó/.test(e.texto)));
  check('baja anulada sin apunte → "Baja anulada"', M.eventos.some(e => e.tipo === 'anulada' && /Baja anulada: <b>ANA/.test(e.texto)));
  check('persona quitada del equipo → evento "quitado"', tipos.includes('quitado'));
  check('los eventos con turno enlazan a su tarjeta (k)', M.eventos.find(e => e.tipo === 'cancel').k === '2026-10-07|10:00 a 12:00');
})();

// ── E11: ficha de voluntario ──
(function E11() {
  console.log('\n═══ E11 · Ficha de voluntario ═══');
  const hoy = '2026-10-15';
  const raw = {
    hist: [
      { fecha:'2026-10-02', rango:'10:00 a 12:00' }, { fecha:'2026-10-06', rango:'10:00 a 12:00' },
      { fecha:'2026-10-09', rango:'10:00 a 12:00' },                 // este tendrá baja activa
      { fecha:'2026-10-20', rango:'19:00 a 21:00' },                 // próximo
      { fecha:'2026-10-22', rango:'19:00 a 21:00' },                 // próximo con baja activa
    ],
    arch: [
      { fecha:'2026-09-05', rango:'10:00 a 12:00' }, { fecha:'2026-09-12', rango:'10:00 a 12:00' },
      { fecha:'2026-10-02', rango:'10:00 a 12:00' },                 // duplicado del historial → no cuenta doble
    ],
    bajas: [
      { fecha:'2026-10-09', rango:'10:00 a 12:00', activa:true },
      { fecha:'2026-10-22', rango:'19:00 a 21:00', activa:true },
      { fecha:'2026-09-19', rango:'10:00 a 12:00', activa:false },
    ],
    refs: [{ fecha:'2026-10-25', rango:'10:00 a 12:00', es_dia_completo:false }, { fecha:'2026-10-26', rango:null, es_dia_completo:true }],
    disp: [{ semana:1, dia:'Sábado', horario:'10:00 a 13:00' }, { semana:2, dia:'Sabado', horario:'10:00 a 13:00' }, { semana:1, dia:'Lunes', horario:null }],
    media60: 2, cancelados: 1,
  };
  const F = E._fichaModelo(raw, hoy);
  check('turnos hechos = pasados sin baja, sin duplicar el archivo (02/10, 06/10, 05/09, 12/09 = 4)', F.hechos === 4, F.hechos + '');
  check('próximos = futuros sin baja (solo el 20/10)', F.proximos.length === 1 && F.proximos[0].fecha === '2026-10-20');
  check('bajas: 3 en total y 1 activa próxima', F.bajasTotal === 3 && F.bajasActivas === 1, `${F.bajasTotal}/${F.bajasActivas}`);
  check('tasa de baja = 3 bajas / 7 turnos asignados = 43 %', F.tasaBaja === 43, F.tasaBaja + '');
  check('últimos 60 días: 02/10 y 06/10 y 12/09 y 05/09 dentro (4)', F.n60 === 4, F.n60 + '');
  check('último turno 06/10 → hace 9 días', F.ultimo.fecha === '2026-10-06' && F.diasDesde === 9, F.diasDesde + '');
  check('carga alta: 4 turnos con media 2 (>1,5×)', F.flags.some(f => f.tipo === 'carga'));
  check('bajas frecuentes: ≥3 y ≥25 %', F.flags.some(f => f.tipo === 'bajas'));
  check('no se marca inactivo (tiene turno reciente)', !F.flags.some(f => f.tipo === 'inactivo'));
  check('apuntes: 2 (1 de día completo) y 1 cancelado', F.apuntes === 2 && F.apuntesDia === 1 && F.cancelados === 1);
  check('turnos por mes: sep 2, oct 3 (2 hechos + 1 próximo)', F.meses.find(m => m.k === '2026-09').n === 2 && F.meses.find(m => m.k === '2026-10').n === 3);
  check('disponibilidad: 2 franjas con horario, un solo día (Sábado)', F.huecosDispo === 2 && F.diasDispo.length === 1);
  const ina = E._fichaModelo({ hist: [{ fecha:'2026-07-01', rango:'10:00 a 12:00' }], arch: [], bajas: [], refs: [], disp: [], media60: 2 }, hoy);
  check('sin turnos desde hace más de 45 días y ninguno programado → inactivo', ina.flags.some(f => f.tipo === 'inactivo'));
  const vacio = E._fichaModelo({ hist: [], arch: [], bajas: [], refs: [], disp: [] }, hoy);
  check('voluntario sin historia: ceros y sin fallar', vacio.hechos === 0 && vacio.tasaBaja === null && vacio.ultimo === null);
})();

// ── E12: estadísticas — cifras calculadas a mano sobre un escenario cerrado ──
(function E12() {
  console.log('\n═══ E12 · Estadísticas: periodos, agregados e insights ═══');
  // Periodos
  const p3 = E._stPeriodo('3m', '2026-10-15');
  check('"3 meses" = ago-sep-oct 2026 y su periodo previo (may-jul)', p3.desde === '2026-08-01' && p3.hasta === '2026-10-31' && p3.meses === 3 && p3.previo.desde === '2026-05-01' && p3.previo.hasta === '2026-07-31');
  const pm = E._stPeriodo('mes', '2026-10-15');
  check('"este mes" = octubre y previo = septiembre', pm.desde === '2026-10-01' && pm.hasta === '2026-10-31' && pm.previo.desde === '2026-09-01' && pm.previo.hasta === '2026-09-30');
  const pa = E._stPeriodo('anio', '2026-10-15');
  check('"este año" = 12 meses y previo = 2025', pa.desde === '2026-01-01' && pa.hasta === '2026-12-31' && pa.meses === 12 && pa.previo.desde === '2025-01-01');
  check('"todo" empieza en el mes del primer dato y no tiene previo', E._stPeriodo('todo', '2026-10-15', null, '2026-05-09').desde === '2026-05-01' && E._stPeriodo('todo', '2026-10-15', null, '2026-05-09').previo === null);
  const pc = E._stPeriodo('custom', '2026-10-15', { desde: '2026-09', hasta: '2026-07' });
  check('rango personalizado con fechas invertidas se ordena solo', pc.desde === '2026-07-01' && pc.hasta === '2026-09-30' && pc.meses === 3);
  check('febrero: último día correcto (año no bisiesto)', E._stPeriodo('mes', '2027-02-10').hasta === '2027-02-28');

  // Escenario (hoy = 15/10/2026, MIN 3, IDEAL 4)
  const ids = 'abcdefghijkl'.split('');
  const vols = ids.map(id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: id === 'a', activo: id !== 'k', creado_en: id === 'l' ? '2026-04-01T10:00:00Z' : '2026-05-10T10:00:00Z' }));
  const H = (fecha, rango, id) => ({ fecha, rango, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  const eq = (fecha, rango, xs) => xs.split('').map(id => H(fecha, rango, id));
  const R1 = '10:00 a 12:00', R2 = '19:00 a 21:00';
  const raw = {
    vols,
    hist: [
      ...eq('2026-10-02', R1, 'abcd'),          // T1 completo
      ...eq('2026-10-06', R1, 'abcd'),          // T2 baja de b, entra e → aguanta con su propio equipo
      ...eq('2026-10-09', R2, 'efg'),           // T3 bajas e,f; entran h,i → salvado
      ...eq('2026-10-12', R1, 'fg'),            // T4 bajas f,g → caído
      ...eq('2026-10-13', R2, 'hi'),            // T5 solo 2 → débil
      ...eq('2026-10-20', R1, 'abc'),           // T7 futuro
    ],
    arch: [...eq('2026-09-10', R1, 'abcde'), H('2026-03-05', R1, 'l')],   // T0 (mes anterior, archivado) + un turno antiguo de L (hace más de 6 meses), que no volvió
    bajas: [
      { voluntario_id: 'b', fecha: '2026-10-06', rango: R1, registrado_en: '2026-10-05T10:00:00Z', activa: true },   // 1 día
      { voluntario_id: 'e', fecha: '2026-10-09', rango: R2, registrado_en: '2026-10-09T08:00:00Z', activa: true },   // mismo día
      { voluntario_id: 'f', fecha: '2026-10-09', rango: R2, registrado_en: '2026-10-01T08:00:00Z', activa: true },   // >7 días
      { voluntario_id: 'f', fecha: '2026-10-12', rango: R1, registrado_en: '2026-10-11T08:00:00Z', activa: true },   // 1 día
      { voluntario_id: 'g', fecha: '2026-10-12', rango: R1, registrado_en: '2026-10-12T08:00:00Z', activa: true },   // mismo día
      { voluntario_id: 'c', fecha: '2026-10-06', rango: R1, registrado_en: '2026-10-01T08:00:00Z', activa: false },  // anulada, 4-7 días
    ],
    refs: [
      { voluntario_id: 'e', fecha: '2026-10-06', rango: R1, es_dia_completo: false, registrado_en: '2026-10-05T12:00:00Z' },
      { voluntario_id: 'h', fecha: '2026-10-09', rango: R2, es_dia_completo: false, registrado_en: '2026-10-08T12:00:00Z' },
      { voluntario_id: 'i', fecha: '2026-10-09', rango: R2, es_dia_completo: false, registrado_en: '2026-10-08T12:00:00Z' },
      { voluntario_id: 'h', fecha: '2026-10-14', rango: R1, es_dia_completo: false, registrado_en: '2026-10-10T12:00:00Z' },   // T6 sin equipo previo
      { voluntario_id: 'i', fecha: '2026-10-14', rango: R1, es_dia_completo: false, registrado_en: '2026-10-10T12:00:00Z' },
      { voluntario_id: 'j', fecha: '2026-10-14', rango: R1, es_dia_completo: false, registrado_en: '2026-10-10T12:00:00Z' },
      { voluntario_id: 'h', fecha: '2026-10-16', rango: null, es_dia_completo: true, registrado_en: '2026-10-10T12:00:00Z' },
    ],
    act: [{ ts: '2026-10-10T09:00:00Z', tipo: 'apunte_cancelado', voluntario_id: 'j', fecha: '2026-10-14', rango: R1 }],
  };
  const hoy = '2026-10-15';
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const S = E._statsAgregar(base, raw, '2026-10-01', '2026-10-31', hoy);
  const P = E._statsAgregar(base, raw, '2026-09-01', '2026-09-30', hoy);
  const T = S.turnos, B = S.bajas, A = S.apuntes, V = S.voluntarios;

  check('turnos del periodo: 7 (6 pasados + 1 próximo); confirmados = con 3 o más personas: T1, T2, T3, T6 y el próximo = 5', T.total === 7 && T.pasados === 6 && T.proximos === 1 && T.confirmados === 5, `${T.total}/${T.pasados}/${T.proximos}/${T.confirmados}`);
  check('plazas asignadas: 18', S.asignaciones === 18, S.asignaciones + '');
  check('bajas: 6 (5 efectivas, 1 anulada), tasa 33,3 %', B.total === 6 && B.efectivas === 5 && B.anuladas === 1 && B.tasa === 33.3, `${B.total}/${B.efectivas}/${B.anuladas}/${B.tasa}`);
  const ant = Object.fromEntries(B.antelacion.map(a => [a.k, a.n]));
  check('antelación: 2 mismo día, 2 un día antes, 1 de 4-7, 1 de más de 7', ant['Mismo día o después'] === 2 && ant['1 día antes'] === 2 && ant['4-7 días'] === 1 && ant['Más de 7 días'] === 1 && ant['2-3 días'] === 0, JSON.stringify(ant));
  check('bajas de última hora: 4 de 6 = 67 %', B.ultimaHora === 67, B.ultimaHora + '');
  check('apuntes: 7 (6 a turno, 1 de día completo); 3 a turnos con baja; 1 cancelado', A.total === 7 && A.aTurno === 6 && A.diaCompleto === 1 && A.cubrenBaja === 3 && A.cancelados === 1, `${A.total}/${A.aTurno}/${A.diaCompleto}/${A.cubrenBaja}/${A.cancelados}`);
  check('turnos con baja: 3 (T2, T3, T4)', T.conBaja === 3);
  check('T3 se salva por apuntes; T2 aguanta sola; T4 cae a cero', T.salvados === 1 && T.aguantaron === 1 && T.caidos === 1);
  check('T6 (sin equipo, 3 apuntes) sale adelante solo por apuntes → 2 salen por apuntes', T.creadosOk === 1 && T.salenPorApuntes === 2);
  check('cómo acaban: 2 completos, 2 justos, 1 débil, 1 sin nadie', T.completos === 2 && T.justos === 2 && T.debiles === 1 && T.caidos === 1);
  check('personas por turno: 16/6 = 2,67; 67 % llega al mínimo', Math.abs(T.nMedia - 16 / 6) < 1e-9 && T.pctMin === 67 && T.pctBajoMin === 33);
  check('turnos sin portador de llave: 3 (T3, T5, T6)', T.sinLlave === 3, T.sinLlave + '');
  check('participación: 9 de 11 activos = 82 % (cuentan también los que acudieron apuntándose: E, H, I, J; el inactivo no)', V.participantes === 9 && V.activos === 11 && V.inactivos === 1 && V.participacion === 82, `${V.participantes}/${V.activos}/${V.participacion}`);
  check('concentración (turnos por voluntario 3,3,3,3,2,2,1,1,1 = 19): 3 primeros = 47 %, 20 % más activo = 32 %', V.top3Share === 47 && V.top20Share === 32, `${V.top3Share}/${V.top20Share}`);
  check('dejaron de participar (más de 6 meses sin turnos): solo L (último turno en marzo)', V.sugeridos.map(r => r.id).join() === 'l', V.sugeridos.map(r => r.id).join());
  check('sin estrenar: solo F (J ya acudió al turno formado por apuntes); K inactivo no cuenta', V.sinEstrenar.map(r => r.id).sort().join() === 'f', V.sinEstrenar.map(r => r.id).join());
  check('turnos confirmados desglosados: 4 ya hechos y 1 próximo', T.confPasados === 4 && T.confProg === 1, T.confPasados + '/' + T.confProg);
  const fila = id => S.tabla.find(r => r.id === id);
  check('tabla: A hizo 3 turnos y tiene llave; B 2 turnos, 1 baja sobre 3 plazas (33 %)', fila('a').turnos === 3 && fila('a').llave && fila('b').turnos === 2 && fila('b').bajas === 1 && fila('b').tasa === 33, JSON.stringify({ b: fila('b') }).slice(0, 120));
  check('último turno de E = 06/10 (se apuntó a ese turno, que se hizo con 4; el del 9/10 acabó en baja)', fila('e').ultimo === '2026-10-06', fila('e').ultimo);
  check('serie mensual: 1 mes con 7 turnos, 6 bajas, 7 apuntes', S.meses.length === 1 && S.meses[0].turnos === 7 && S.meses[0].bajas === 6 && S.meses[0].apuntes === 7);
  const dia = d => S.porDia.find(x => x.dow === d);
  check('por día: el lunes 12/10 fue 1 turno con 2 bajas', dia(1).turnos === 1 && dia(1).bajas === 2, JSON.stringify(dia(1)));

  // Periodo anterior
  check('septiembre: 1 turno archivado, 5 plazas, sin rastro de bajas → mes "manual": no entra en la tasa (sin base)', P.turnos.total === 1 && P.asignaciones === 5 && P.bajas.total === 0 && P.bajas.tasa === null && P.bajas.base === 0 && P.cobertura.manuales.length === 1);

  // Insights
  const ins = E._statsInsights(S, P), tit = ins.map(i => i.titulo).join(' | ');
  const niv = t => ins.find(i => i.titulo.includes(t))?.nivel;
  check('insight rojo: turno sin nadie', niv('sin nadie') === 'rojo', tit);
  check('insight rojo: tasa de baja 33,3 %', niv('Tasa de baja') === 'rojo');
  check('insight: bajas de un día para otro', ins.some(i => /de un día para otro/.test(i.titulo)));
  check('insight verde: Sustituciones salvó 1 turno', niv('Sustituciones salvó') === 'verde');
  check('insight verde: turno salido solo por apuntes', niv('solo por apuntes') === 'verde');
  check('insight: turnos sin portador de llave', ins.some(i => /sin portador/.test(i.titulo)));
  check('insight: voluntarios que dejaron de participar', ins.some(i => /dejó de participar|dejaron de participar/.test(i.titulo)));
  check('no salta "sin estrenar" con solo 2 casos (mínimo 3)', !ins.some(i => /nunca han tenido/.test(i.titulo)));
  check('con 9 participantes y el 47 % en los 3 primeros sí salta "Los 3 más activos hacen el 47 %"', ins.some(i => /Los 3 más activos hacen el 47 %/.test(i.titulo)), ins.map(i => i.titulo).join(' | '));
  check('los insights salen ordenados: rojos primero, verdes al final', ['rojo', 'ambar', 'info', 'verde'].indexOf(ins[0].nivel) === 0 && ins[ins.length - 1].nivel === 'verde');

  // Datos vacíos: no debe romper
  const vacio = { vols: [], hist: [], arch: [], bajas: [], refs: [], act: null };
  const Sv = E._statsAgregar(E._statsBase(vacio, {}), vacio, '2026-10-01', '2026-10-31', hoy);
  check('sin datos: ceros y tasa nula, sin excepciones', Sv.asignaciones === 0 && Sv.bajas.tasa === null && Sv.turnos.pctMin === null && Sv.apuntes.cancelados === null && E._statsInsights(Sv, null).length >= 1);
})();

// ── E13: calidad de los datos, evidencia y "confirmado desde apunte" ──
(function E13() {
  console.log('\n═══ E13 · Datos incompletos: meses sin registro y evidencia ═══');
  const hoy = '2026-09-21';
  const R1 = '10:00 a 12:00';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const H = (fecha, id) => ({ fecha, rango: R1, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  // Como los datos reales: mayo en la app (con bajas), jun-ago sin nada, septiembre en la app
  const raw = {
    vols: 'abcdefgh'.split('').map(V),
    hist: [H('2026-09-08', 'a'), H('2026-09-08', 'b'), H('2026-09-08', 'c'), H('2026-09-15', 'a'), H('2026-09-15', 'b'), H('2026-09-15', 'c')],
    arch: [H('2026-05-09', 'd'), H('2026-05-09', 'e'), H('2026-05-09', 'f'), H('2026-05-16', 'd'), H('2026-05-16', 'g')],
    bajas: [{ voluntario_id: 'e', fecha: '2026-05-09', rango: R1, registrado_en: '2026-05-08T10:00:00Z', activa: true }, { voluntario_id: 'b', fecha: '2026-09-15', rango: R1, registrado_en: '2026-09-10T10:00:00Z', activa: true }],
    refs: [], act: null,
  };
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const S = E._statsAgregar(base, raw, '2026-05-01', '2026-09-30', hoy, { mesesSinParticipar: 3 });
  const est = Object.fromEntries(S.cobertura.meses.map(m => [m.k, m.estado]));
  check('estados por mes: mayo y septiembre con registro; jun, jul, ago sin datos', est['2026-05'] === 'app' && est['2026-09'] === 'app' && est['2026-06'] === 'vacio' && est['2026-07'] === 'vacio' && est['2026-08'] === 'vacio', JSON.stringify(est));
  check('la serie mensual marca los meses vacíos', S.meses.filter(m => m.estado === 'vacio').length === 3);
  check('mes en curso o futuro sin turnos NO se marca como hueco', E._stEstadoMes(null, '2026-09', hoy, false) === 'futuro' && E._stEstadoMes(null, '2026-11', hoy, false) === 'futuro' && E._stEstadoMes(null, '2026-06', hoy, false) === 'vacio');
  check('mes con turnos y sin ningún rastro de bajas/apuntes = "manual"; con marca del usuario = "app"', E._stEstadoMes({ asig: 4, bajas: 0, apuntes: 0 }, '2026-06', hoy, false) === 'manual' && E._stEstadoMes({ asig: 4, bajas: 0, apuntes: 0 }, '2026-06', hoy, true) === 'app');
  check('la tasa de baja usa solo meses con registro (2 bajas / 11 plazas = 18,2 %)', S.bajas.base === 11 && S.bajas.tasa === 18.2, `${S.bajas.base}/${S.bajas.tasa}`);
  const ins = E._statsInsights(S, null);
  check('insight ámbar: faltan datos de 3 meses', ins.some(i => i.nivel === 'ambar' && /Sin datos en 3 meses/.test(i.titulo)));
  check('D, F, G (último turno en mayo) NO se dan por "dejaron de participar": solo hay un mes con datos posterior', S.voluntarios.sugeridos.length === 0 && S.voluntarios.sinEvidencia.map(r => r.id).sort().join() === 'd,f,g', S.voluntarios.sinEvidencia.map(r => r.id).join());
  check('"sin estrenar": H (nunca asignado) y E (su único turno acabó en baja); hay 2 meses con datos', S.voluntarios.sinEstrenar.map(r => r.id).sort().join() === 'e,h', S.voluntarios.sinEstrenar.map(r => r.id).join());
  check('con solo 11 plazas con registro (<15) no salta el insight de tasa alta', S.bajas.tasa === 18.2 && !ins.some(i => /Tasa de baja/.test(i.titulo)));

  // Si se importan los meses que faltan (jun-ago), la conclusión cambia: D ya llevaba 4 meses sin participar
  raw.arch.push(H('2026-06-06', 'a'), H('2026-06-06', 'b'), H('2026-06-06', 'c'), H('2026-07-04', 'a'), H('2026-07-04', 'b'), H('2026-07-04', 'c'), H('2026-08-01', 'a'), H('2026-08-01', 'b'), H('2026-08-01', 'c'));
  const base2 = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const S2 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy, { mesesSinParticipar: 3 });
  const est2 = Object.fromEntries(S2.cobertura.meses.map(m => [m.k, m.estado]));
  check('tras importar, jun-ago pasan a "manual" (turnos sin rastro de bajas)', est2['2026-06'] === 'manual' && est2['2026-07'] === 'manual' && est2['2026-08'] === 'manual');
  check('y ahora sí se puede afirmar que D, F y G dejaron de participar (4 meses con datos después)', S2.voluntarios.sugeridos.map(r => r.id).sort().join() === 'd,f,g' && S2.voluntarios.sinEvidencia.length === 0, S2.voluntarios.sugeridos.map(r => r.id).join());
  check('los meses manuales no diluyen la tasa: sigue sobre las 11 plazas con registro', S2.bajas.base === 11 && S2.bajas.tasa === 18.2, `${S2.bajas.base}/${S2.bajas.tasa}`);
  const S3 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy, { mesesOk: new Set(['2026-06', '2026-07', '2026-08']), mesesSinParticipar: 3 });
  check('si el usuario marca esos meses como "registro completo", pasan a contar en la tasa (20 plazas, 2 bajas = 10 %)', S3.bajas.base === 20 && S3.bajas.tasa === 10, `${S3.bajas.base}/${S3.bajas.tasa}`);

  // El plazo de "dejó de participar" es configurable (por defecto 6 meses)
  const S6 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy);
  check('por defecto (6 meses) quien hizo su último turno en mayo (hace 4 meses) NO se da por perdido ni por dudoso', S6.voluntarios.sugeridos.length === 0 && S6.voluntarios.sinEvidencia.length === 0 && S6.voluntarios.umbralMeses === 6);
  const S12 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy, { mesesSinParticipar: 12 });
  check('con 3 meses sí (D, F, G) y con 12 meses tampoco: el plazo cambia el resultado', S2.voluntarios.sugeridos.length === 3 && S2.voluntarios.umbralMeses === 3 && S12.voluntarios.sugeridos.length === 0 && S12.voluntarios.umbralMeses === 12);
  // Apunte ya confirmado en el equipo: cuenta como "salido por apuntes", no como equipo propio
  const R = { vols: 'abcd'.split('').map(V), hist: ['a', 'b', 'c'].map(id => H('2026-09-10', id)), arch: [], bajas: [],
    refs: ['a', 'b', 'c'].map(id => ({ voluntario_id: id, fecha: '2026-09-10', rango: R1, es_dia_completo: false, registrado_en: '2026-09-05T10:00:00Z' })), act: null };
  const Sa = E._statsAgregar(E._statsBase(R, { MIN_EQ: 3, IDEAL: 4 }), R, '2026-09-01', '2026-09-30', hoy);
  check('turno formado solo por apuntes y luego CONFIRMADO: cuenta como turno confirmado y como "salido por apuntes"', Sa.turnos.confirmados === 1 && Sa.turnos.creadosOk === 1 && Sa.turnos.salenPorApuntes === 1, JSON.stringify({ c: Sa.turnos.confirmados, ok: Sa.turnos.creadosOk }));
})();

// ── E14: importador de turnos anteriores ──
(function E14() {
  console.log('\n═══ E14 · Importador de turnos anteriores ═══');
  const l = (t) => E._impParsearLinea(t, 2026);
  let r = l('12/06/2026   10:00 a 12:00   ANA GARCIA, LUIS PEREZ, MARIA SOTO');
  check('línea con tabuladores/espacios y comas', r.fecha === '2026-06-12' && r.rango === '10:00 a 12:00' && r.nombres.join('|') === 'ANA GARCIA|LUIS PEREZ|MARIA SOTO', JSON.stringify(r));
  r = l('13/06/2026;19-21;PILAR RUIZ; JOSE MARTIN; ROSA LOPEZ');
  check('separadores ; y franja "19-21"', r.fecha === '2026-06-13' && r.rango === '19:00 a 21:00' && r.nombres.length === 3, JSON.stringify(r));
  r = l('2026-07-04 | 10h - 12h | Ana Garcia + Luis Perez');
  check('fecha ISO, franja "10h - 12h" y separador +', r.fecha === '2026-07-04' && r.rango === '10:00 a 12:00' && r.nombres.length === 2, JSON.stringify(r));
  r = l('5/7/26 9:30 a 11:30 ANA GARCIA');
  check('fecha corta d/m/aa y franja con minutos', r.fecha === '2026-07-05' && r.rango === '09:30 a 11:30', JSON.stringify(r));
  r = l('20/06 10 a 12 ANA GARCIA, LUIS PEREZ');
  check('sin año → usa el año actual', r.fecha === '2026-06-20' && r.rango === '10:00 a 12:00');
  check('línea vacía y comentario se ignoran', l('') === null && l('# comentario') === null);
  check('errores claros: sin fecha, sin franja, sin nombres, fecha imposible', /fecha/.test(l('ANA GARCIA 10-12').error) && /franja/.test(l('12/06/2026 ANA GARCIA').error) && /nombres/.test(l('12/06/2026 10-12').error) && /no válida/.test(l('31/02/2026 10-12 ANA').error), [l('ANA GARCIA 10-12').error, l('12/06/2026 ANA GARCIA').error, l('12/06/2026 10-12').error, l('31/02/2026 10-12 ANA').error].join(' / '));
  const P = E._impParsear('12/06/2026 10-12 ANA GARCIA, LUIS PEREZ\n12/06/2026 10-12 luis perez, ROSA LOPEZ\nfoo\n13/06/2026 19-21 PILAR RUIZ', 2026);
  check('líneas del mismo turno se unen y sin repetir a nadie; la línea "foo" es un error', P.turnos.length === 2 && P.turnos[0].nombres.length === 3 && P.errores.length === 1, JSON.stringify(P.turnos[0].nombres));

  const vols = [{ id: '1', nombre: 'ANA GARCIA LOPEZ' }, { id: '2', nombre: 'LUIS PEREZ' }, { id: '3', nombre: 'MARIA SOTO' }, { id: '4', nombre: 'MARIA GARCIA' }, { id: '5', nombre: 'JOSÉ ÁNGEL RUIZ' }];
  check('emparejado exacto ignorando mayúsculas y tildes', E._impEmparejar('luis  pérez', vols).tipo === 'exacto' && E._impEmparejar('jose angel ruiz', vols).v.id === '5');
  check('emparejado aproximado: nombre incompleto que solo cuadra con uno', E._impEmparejar('ANA GARCIA', vols).tipo === 'aprox' && E._impEmparejar('ANA GARCIA', vols).v.id === '1');
  check('ambiguo: un apellido que cuadra con dos → no adivina', E._impEmparejar('GARCIA', vols).tipo === 'ambiguo' && E._impEmparejar('GARCIA', vols).cands.length === 2);
  check('desconocido → ninguno', E._impEmparejar('PEDRO INEXISTENTE', vols).tipo === 'ninguno');

  const hoy = '2026-09-21', exist = new Set(['2|2026-06-12|10:00 a 12:00']);
  const parsed = E._impParsear('12/06/2026 10-12 ANA GARCIA, LUIS PEREZ, GARCIA, PEDRO X\n05/09/2026 10-12 MARIA SOTO\n03/10/2026 10-12 MARIA SOTO', 2026);
  let plan = E._impPlan(parsed, vols, exist, hoy, {});
  check('plan: ANA es nueva y LUIS ya existía (duplicado, no se repite)', plan.registros.map(r => r.voluntario_id + '@' + r.fecha).join() === '1@2026-06-12' && plan.duplicados === 1, JSON.stringify(plan.registros.map(r => r.voluntario_id + '@' + r.fecha)));
  check('los nombres dudosos quedan sin resolver (GARCIA, PEDRO X), no se inventa nada', plan.sinResolver.map(x => x.txt).sort().join() === 'GARCIA,PEDRO X', plan.sinResolver.map(x => x.txt).join());
  check('solo se importan meses anteriores al actual (el 05/09 y el 03/10 quedan fuera)', plan.fueraRango.length === 2 && !plan.registros.some(r => r.fecha >= '2026-09-01'), plan.fueraRango.length + '');
  plan = E._impPlan(parsed, vols, exist, hoy, { GARCIA: '4', 'PEDRO X': '' });
  check('el usuario resuelve GARCIA→MARIA GARCIA y omite a PEDRO X', plan.registros.some(r => r.voluntario_id === '4') && plan.sinResolver.length === 0);
  const reg = plan.registros[0];
  check('registro con el formato de historial_archivo: semana, día sin tilde, mes_archivo', reg.fecha === '2026-06-12' && reg.dia === 'Viernes' && reg.semana === 2 && reg.mes_archivo === '2026-06' && reg.nombre_snap && reg.rango === '10:00 a 12:00', JSON.stringify(reg));
  const dia = E._impPlan(E._impParsear('11/06/2026 19-21 MARIA SOTO', 2026), vols, new Set(), hoy, {}).registros[0];
  check('día sin tilde: jueves y miércoles/sábado como en la base de datos', dia.dia === 'Jueves' && E._impPlan(E._impParsear('10/06/2026 19-21 MARIA SOTO', 2026), vols, new Set(), hoy, {}).registros[0].dia === 'Miercoles');
})();

// ── E15: turnos que no salieron adelante en las estadísticas ──
(function E15() {
  console.log('\n═══ E15 · Estadísticas: turnos que no salieron adelante ═══');
  const hoy = '2026-10-15', R1 = '10:00 a 12:00', R2 = '16:00 a 18:00';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-04-01T10:00:00Z' });
  const H = (fecha, rango, id) => ({ fecha, rango, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  const raw = {
    vols: 'abcd'.split('').map(V),
    hist: [], bajas: [], refs: [], act: null,
    arch: [...'abcd'.split('').map(i => H('2026-05-02', R1, i)), ...'ab'.split('').map(i => H('2026-05-09', R1, i)), ...'abc'.split('').map(i => H('2026-05-16', R1, i)), ...'abc'.split('').map(i => H('2026-05-23', R1, i))],
    noReal: [
      { fecha: '2026-05-03', rango: R2, motivo: 'sin voluntarios', planificados: 0 }, { fecha: '2026-05-10', rango: R2, motivo: 'sin voluntarios', planificados: 0 },
      { fecha: '2026-05-17', rango: R2, motivo: 'sin voluntarios', planificados: 0 }, { fecha: '2026-05-24', rango: R2, motivo: 'sin voluntarios', planificados: 0 },   // 4 domingos por la tarde
      { fecha: '2026-05-30', rango: R1, motivo: 'bajas', planificados: 3 }, { fecha: '2026-05-31', rango: R1, motivo: 'otro', planificados: 0 },
    ],
  };
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const S = E._statsAgregar(base, raw, '2026-05-01', '2026-05-31', hoy);
  const T = S.turnos;
  check('4 turnos con gente (3 con 3 o más = confirmados) y 6 registrados como no realizados', T.total === 4 && T.confirmados === 3 && T.sinCubrir === 6, `${T.total}/${T.confirmados}/${T.sinCubrir}`);
  check('salen adelante 3 de 10 = 30 % (el del 9/5 tuvo solo 2 personas → no se hizo; + 6 sin cubrir)', T.salieron === 3 && T.noSalieron === 7 && T.programados === 10 && T.pctSalen === 30, `${T.salieron}/${T.noSalieron}/${T.programados}/${T.pctSalen}`);
  check('motivos: 5 sin voluntarios/otros y 1 por bajas', T.motivos['sin voluntarios'] === 4 && T.motivos.bajas === 1 && T.motivos.otro === 1, JSON.stringify(T.motivos));
  check('las franjas sin cubrir no cuentan como turnos con gente (media de personas no se hunde)', Math.abs(T.nMedia - 3) < 1e-9, T.nMedia + '');
  check('mapa: los domingos por la tarde tienen 4 sin cubrir y 0 turnos; el domingo entero suma 5', S.celdas.t[0].sinCubrir === 4 && S.celdas.t[0].turnos === 0 && S.porDia.find(d => d.dow === 0).sinCubrir === 5, `${S.celdas.t[0].sinCubrir}/${S.porDia.find(d => d.dow === 0).sinCubrir}`);
  check('la serie mensual solo cuenta turnos con gente (4)', S.meses.length === 1 && S.meses[0].turnos === 4);
  const ins = E._statsInsights(S, null), tit = ins.map(i => i.titulo).join(' | ');
  check('insight rojo: solo salen adelante 3 de 10 (30 %)', ins.some(i => i.nivel === 'rojo' && /Solo salen adelante 3 de 10/.test(i.titulo)), tit);
  check('insight: los domingos por la tarde casi nunca se cubren', ins.some(i => /domingos por la tarde casi nunca/.test(i.titulo)), tit);
  check('mayo sin bajas ni apuntes sigue siendo "manual" y con datos (tiene turnos)', S.cobertura.manuales.length === 1 && S.cobertura.vacios.length === 0);
  // un mes con SOLO turnos sin cubrir cuenta como con datos manuales, no como vacío
  check('mes con solo franjas sin cubrir (sin asignaciones) = "manual", no "vacío"', E._stEstadoMes({ asig: 0, bajas: 0, apuntes: 0, noReal: 3 }, '2026-06', hoy, false) === 'manual');
  // si un registro de no realizado coincide con un turno que sí tiene gente, manda la gente
  const raw2 = { ...raw, noReal: [{ fecha: '2026-05-02', rango: R1, motivo: 'otro', planificados: 0 }] };
  const S2 = E._statsAgregar(E._statsBase(raw2, { MIN_EQ: 3, IDEAL: 4 }), raw2, '2026-05-01', '2026-05-31', hoy);
  check('conflicto: turno con gente registrado también como no realizado → manda la gente (sinCubrir 0; salen 3 con 3 o más)', S2.turnos.sinCubrir === 0 && S2.turnos.salieron === 3);
  // sin tabla (null) no rompe
  const raw3 = { ...raw, noReal: null };
  check('sin la tabla turnos_no_realizados (null) todo sigue funcionando', E._statsAgregar(E._statsBase(raw3, { MIN_EQ: 3 }), raw3, '2026-05-01', '2026-05-31', hoy).turnos.sinCubrir === 0);
})();

// ── E16: lector del "Programa de Predicación" (PDF) y turnos que no salieron adelante ──
(function E16() {
  console.log('\n═══ E16 · Importar programas en PDF ═══');
  const nm = ['ANA PEREZ', 'LUIS MARTIN', 'MARIA DIAZ', 'PEDRO RUIZ', 'LAURA GIL', 'JOSE MANUEL VEGA', 'CARLA SOTO', 'ANA DIAZ'];
  const vols = nm.map((n, i) => ({ id: String(i + 1), nombre: n }));
  // Mismo formato que el programa real (texto en orden de lectura), con datos inventados
  const programa = `PROGRAMA PREDICACIÓN PUERTO - MAYO
Sábado 9
 BARCO UNO &
BARCO DOS |
LLegada prevista entre
las 13:00 y 15:00
TURNO
12:00-14:00
  Ana Perez Luis Martin Maria Diaz Pedro Ruiz
TURNO
14:00-16:00
TURNO
16:00-18:00
  Laura Gil Jose Manuel Vega Carla Soto
Domingo 10
 BARCO UNO |
Salida prevista a las
23:00
 Delicias
TURNO
10:00-12:00
  Ana Diaz Luis Martin
TURNO
12:00-14.00
TURNO
14:00-16:00
Jueves 14
 BARCO TRES |
Estancia todo el día
Martes 12
 BARCO TRES |
Llegada prevista entre
las 16:00 Y 18:00
TURNO
17:00-19:00
  Persona Desconocida Ana Perez Luis Marting
TURNO
19:00-21:00
  Maria Diaz Pedro Ruiz Laura Gill
Nota: El nombre sombreado del voluntario indica que tiene llave y por tanto está asignado a recoger.
Si por algún motivo no podéis atender vuestro turno, contactar con ALGUIEN.`;
  check('se reconoce como programa y se detecta el mes', E._impEsPrograma(programa) && !E._impEsPrograma('12/06/2026 10-12 ANA PEREZ'));
  const seg = t => E._impSegmentar(t, vols);
  check('segmenta nombres pegados: 4 personas de 2 palabras', JSON.stringify(seg('Ana Perez Luis Martin Maria Diaz Pedro Ruiz')) === JSON.stringify(['Ana Perez', 'Luis Martin', 'Maria Diaz', 'Pedro Ruiz']), JSON.stringify(seg('Ana Perez Luis Martin Maria Diaz Pedro Ruiz')));
  check('respeta nombres de 3 palabras del diccionario (Jose Manuel Vega)', seg('Laura Gil Jose Manuel Vega Carla Soto').join('|') === 'Laura Gil|Jose Manuel Vega|Carla Soto');
  check('con nombres que comparten palabras (Ana Diaz / Ana Perez / Maria Diaz) elige la coincidencia exacta', seg('Maria Diaz Ana Perez Ana Diaz').join('|') === 'Maria Diaz|Ana Perez|Ana Diaz', seg('Maria Diaz Ana Perez Ana Diaz').join('|'));
  check('un nombre suelto que existe entero no se inventa (una sola palabra no basta)', seg('Luis Martin Pedro').join('|') === 'Luis Martin|Pedro');
  check('nombres que no están en la lista se agrupan de 2 en 2', seg('Persona Desconocida Ana Perez').join('|') === 'Persona Desconocida|Ana Perez' && seg('Aaa Bbb Ccc Ddd').join('|') === 'Aaa Bbb|Ccc Ddd');

  const r = E._impParsearPrograma(programa, 2026, vols);
  const k = (f, ra) => r.turnos.find(t => t.fecha === f && t.rango === ra);
  check('lee 8 turnos (3 + 3 + 2; el día de "Estancia todo el día" sin franjas no cuenta)', r.turnos.length === 8, r.turnos.length + '');
  check('fecha, franja y equipo del sábado 9 (12-14)', k('2026-05-09', '12:00 a 14:00').nombres.join('|') === 'Ana Perez|Luis Martin|Maria Diaz|Pedro Ruiz');
  check('franja con typo "12:00-14.00" se normaliza a 12:00 a 14:00', !!k('2026-05-10', '12:00 a 14:00'));
  check('las franjas en blanco son turnos sin cubrir', k('2026-05-09', '14:00 a 16:00').cancelado && k('2026-05-10', '12:00 a 14:00').cancelado && k('2026-05-10', '14:00 a 16:00').nombres.length === 0);
  check('los días vienen en el orden del programa aunque el texto salte (jueves sin turnos, martes 12 después)', !!k('2026-05-12', '17:00 a 19:00') && !!k('2026-05-12', '19:00 a 21:00'));
  check('el pie ("Nota: …") no se cuela como nombres del último turno', k('2026-05-12', '19:00 a 21:00').nombres.join('|') === 'Maria Diaz|Pedro Ruiz|Laura Gill', k('2026-05-12', '19:00 a 21:00').nombres.join('|'));
  check('mayo de 2026: los días de la semana cuadran → sin avisos', r.avisos.length === 0, r.avisos.join(' / '));
  const r25 = E._impParsearPrograma(programa, 2025, vols);
  check('con el año equivocado (2025) avisa de que los días de la semana no cuadran', r25.avisos.some(a => /no coinciden con el día de la semana/.test(a)), r25.avisos.join(' / '));

  // Sugerencias para erratas
  const sug = t => E._impSugerir(t, vols).map(x => x.v.nombre);
  check('errata "Luis Marting" → sugiere LUIS MARTIN', sug('Luis Marting')[0] === 'LUIS MARTIN');
  check('errata "Laura Gill" → sugiere LAURA GIL', sug('Laura Gill')[0] === 'LAURA GIL');
  check('un nombre sin parecido no sugiere nada', sug('Persona Desconocida').length === 0);
  check('no confunde nombres cortos distintos (EMI ≠ ANA)', sug('Emi Perez').length === 0);

  // Plan de importación
  const hoy = '2026-09-21', parsed = E._impFusionar([r]);
  let plan = E._impPlan(parsed, vols, new Set(), hoy, {}, {});
  const nrKeys = plan.noRealizados.map(n => n.fecha + ' ' + n.rango).sort();
  check('turnos sin cubrir → a no realizados con motivo "sin voluntarios" (3)', plan.noRealizados.length === 3 && plan.noRealizados.every(n => n.motivo === 'sin voluntarios' && n.planificados === 0), nrKeys.join(' | '));
  check('asignaciones con gente reconocida: 4 + 3 + 2 + 1 (Ana Perez) + 2 (Maria Diaz, Pedro Ruiz) = 12', plan.registros.length === 12, plan.registros.length + '');
  check('nombres dudosos: Persona Desconocida, Luis Marting y Laura Gill, con sugerencia para las erratas', plan.sinResolver.map(x => x.txt).sort().join('|') === 'Laura Gill|Luis Marting|Persona Desconocida' && plan.sinResolver.find(x => x.txt === 'Luis Marting').sug[0].v.nombre === 'LUIS MARTIN');
  plan = E._impPlan(parsed, vols, new Set(), hoy, { 'LUIS MARTING': '2', 'LAURA GILL': '5', 'PERSONA DESCONOCIDA': '__nuevo__' }, { omitirVacios: { '2026-05-10|14:00 a 16:00': true }, marcados: { '2026-05-09|16:00 a 18:00': 'bajas' } });
  check('resueltos, y "Persona Desconocida" se crea como voluntario inactivo nuevo', plan.sinResolver.length === 0 && plan.nuevos.length === 1 && plan.nuevos[0].nombre === 'PERSONA DESCONOCIDA' && plan.registros.some(r => r.voluntario_id === 'nuevo:PERSONA DESCONOCIDA'));
  check('un vacío omitido no se registra: 2 vacíos + 1 turno marcado = 3 no realizados', plan.noRealizados.length === 3 && !plan.noRealizados.some(n => n.fecha === '2026-05-10' && n.rango === '14:00 a 16:00'), plan.noRealizados.length + '');
  const marc = plan.noRealizados.find(n => n.rango === '16:00 a 18:00');
  check('turno con gente marcado "no salió adelante" (por bajas): pasa a no realizados con sus 3 previstos y su gente NO se importa', marc && marc.motivo === 'bajas' && marc.planificados === 3 && !plan.registros.some(r => r.fecha === '2026-05-09' && r.rango === '16:00 a 18:00'), JSON.stringify(marc));
  check('lo ya registrado como no realizado no se repite', E._impPlan(parsed, vols, new Set(), hoy, {}, { existentesNR: new Set(['2026-05-09|14:00 a 16:00']) }).noRealizadosDup === 1);

  // Formato de líneas con marca de "no salió"
  const l = t => E._impParsearLinea(t, 2026);
  check('línea "sin voluntarios" → turno cancelado sin gente', l('14/06/2026 12-14 sin voluntarios').cancelado === true && l('14/06/2026 12-14 sin voluntarios').nombres.length === 0 && l('14/06/2026 12-14 sin voluntarios').motivo === 'sin voluntarios');
  check('línea con nombres y "cancelado" → cancelado con su equipo previsto', l('15/06/2026 10-12 ANA PEREZ, LUIS MARTIN cancelado').cancelado === true && l('15/06/2026 10-12 ANA PEREZ, LUIS MARTIN cancelado').nombres.length === 2 && l('15/06/2026 10-12 ANA PEREZ, LUIS MARTIN cancelado').motivo === 'otro');
  check('sin marca y sin nombres sigue siendo un error explicado', /No hay nombres/.test(l('14/06/2026 12-14').error));
})();

// ── E17: "al menos N bajas" indicadas a mano en un mes gestionado fuera de la app ──
(function E17() {
  console.log('\n═══ E17 · Bajas indicadas a mano (mínimo por mes) ═══');
  const hoy = '2026-09-21', R1 = '10:00 a 12:00';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-03-01T10:00:00Z' });
  const H = (fecha, id) => ({ fecha, rango: R1, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  // Abril (importado del programa: 2 turnos de 3, sin bajas conocidas) y mayo (en la app, con 3 bajas registradas)
  const raw = {
    vols: 'abcdef'.split('').map(V), hist: [], refs: [], act: null, noReal: [],
    arch: [...'abc'.split('').map(i => H('2026-04-07', i)), ...'abc'.split('').map(i => H('2026-04-14', i)), ...'def'.split('').map(i => H('2026-05-05', i)), ...'def'.split('').map(i => H('2026-05-12', i))],
    bajas: [1, 2, 3].map(n => ({ voluntario_id: 'd', fecha: '2026-05-05', rango: R1, registrado_en: '2026-05-0' + n + 'T10:00:00Z', activa: true })),
  };
  const agg = (ajustes) => { const r = { ...raw, ajustes }; return E._statsAgregar(E._statsBase(r, { MIN_EQ: 3, IDEAL: 4 }), r, '2026-04-01', '2026-05-31', hoy); };

  const sin = agg([]);
  const estSin = Object.fromEntries(sin.cobertura.meses.map(m => [m.k, m.estado]));
  check('sin ajuste: abril es "manual" (sin rastro de bajas) y NO entra en la tasa (solo mayo: 3 bajas / 6 plazas = 50 %)', estSin['2026-04'] === 'manual' && sin.bajas.base === 6 && sin.bajas.tasa === 50 && !sin.bajas.aprox, `${estSin['2026-04']}/${sin.bajas.base}/${sin.bajas.tasa}`);

  const con = agg([{ mes: '2026-04', bajas_min: 2, nota: 'según coordinación' }, { mes: '2026-05', bajas_min: 2, nota: null }]);
  const estCon = Object.fromEntries(con.cobertura.meses.map(m => [m.k, m.estado]));
  check('con "al menos 2" en abril, el mes pasa a contar para las bajas', estCon['2026-04'] === 'app' && con.bajas.base === 12, `${estCon['2026-04']}/${con.bajas.base}`);
  check('abril aporta 2 bajas indicadas; mayo ya tenía 3 (≥ 2): no suma nada', con.bajas.estimadas === 2 && con.bajas.total === 5 && con.bajas.aprox === true, `${con.bajas.estimadas}/${con.bajas.total}`);
  check('tasa = (3 registradas + 2 indicadas) / 12 plazas = 41,7 % y se marca como aproximada', con.bajas.tasa === 41.7 && con.bajas.aprox, con.bajas.tasa + '');
  check('las bajas registradas siguen siendo 3 (lo indicado no se mezcla con lo real)', con.bajas.efectivas === 3 && con.bajas.anuladas === 0);
  const ser = Object.fromEntries(con.meses.map(m => [m.k, m.bajas]));
  check('la serie mensual muestra 2 bajas en abril y 3 en mayo', ser['2026-04'] === 2 && ser['2026-05'] === 3, JSON.stringify(ser));
  check('lo indicado no inventa turnos ni personas: turnos, plazas y antelación no cambian', con.turnos.total === sin.turnos.total && con.asignaciones === sin.asignaciones && JSON.stringify(con.bajas.antelacion) === JSON.stringify(sin.bajas.antelacion));
  check('un mínimo MENOR que lo ya registrado no cambia nada (mayo: mínimo 1, hay 3)', agg([{ mes: '2026-05', bajas_min: 1 }]).bajas.estimadas === 0);
  const t2 = agg([{ mes: '2026-04', bajas_min: 6, nota: null }]);
  check('con un mínimo mayor la tasa sube: (3 + 6) / 12 = 75 %', t2.bajas.tasa === 75 && t2.bajas.estimadas === 6, t2.bajas.tasa + '');
  check('sin la tabla de ajustes (null) todo sigue igual que sin ajuste', E._statsAgregar(E._statsBase({ ...raw, ajustes: null }, { MIN_EQ: 3 }), { ...raw, ajustes: null }, '2026-04-01', '2026-05-31', hoy).bajas.tasa === 50);
  check('un ajuste sin turnos ese mes (abril sin importar) cuenta en el total pero no inventa una tasa', (() => { const r = { ...raw, arch: raw.arch.filter(a => a.fecha >= '2026-05'), ajustes: [{ mes: '2026-04', bajas_min: 2 }] }; const x = E._statsAgregar(E._statsBase(r, { MIN_EQ: 3 }), r, '2026-04-01', '2026-05-31', hoy); return x.bajas.total === 5 && x.bajas.base === 6 && x.bajas.tasa === 50; })());
  check('el insight de tasa habla de "al menos" cuando incluye lo indicado', (() => { const big = { ...raw, arch: [...raw.arch, ...[...Array(6)].flatMap((_, i) => 'abcdef'.split('').map(id => H('2026-04-' + String(20 + i).padStart(2, '0'), id)))], ajustes: [{ mes: '2026-04', bajas_min: 12 }] }; const x = E._statsAgregar(E._statsBase(big, { MIN_EQ: 3 }), big, '2026-04-01', '2026-05-31', hoy); return E._statsInsights(x, null).some(i => /de al menos el/.test(i.titulo)); })());
})();

// ── E18: criterio "3 o más personas = se hizo; menos, o ninguna = no realizado" ──
(function E18() {
  console.log('\n═══ E18 · Criterio: 3 o más personas = turno hecho ═══');
  const hoy = '2026-09-21';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const H = (fecha, rango, id) => ({ fecha, rango, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  const RM = '10:00 a 12:00', RT = '19:00 a 21:00', RN = '20:00 a 22:00';
  const raw = {
    vols: 'abcdefghij'.split('').map(V), arch: [], act: null, noReal: [],
    hist: [
      ...'abcd'.split('').map(i => H('2026-09-15', RM, i)),          // 4 personas, sin bajas → se hace
      ...'efg'.split('').map(i => H('2026-09-15', RT, i)),           // 3 confirmados, 2 de baja → queda 1 → NO se hace (el caso real del día 15)
    ],
    bajas: [{ voluntario_id: 'e', fecha: '2026-09-15', rango: RT, registrado_en: '2026-09-13T10:00:00Z', activa: true }, { voluntario_id: 'f', fecha: '2026-09-15', rango: RT, registrado_en: '2026-09-14T10:00:00Z', activa: true }],
    refs: [
      ...'hij'.split('').map(i => ({ voluntario_id: i, fecha: '2026-09-06', rango: RM, es_dia_completo: false, registrado_en: '2026-09-01T10:00:00Z' })),   // solo apuntes, 3 → se hace
      ...'ab'.split('').map(i => ({ voluntario_id: i, fecha: '2026-09-06', rango: RN, es_dia_completo: false, registrado_en: '2026-09-01T10:00:00Z' })),    // solo apuntes, 2 → no
      { voluntario_id: 'c', fecha: '2026-09-05', rango: RN, es_dia_completo: false, registrado_en: '2026-09-01T10:00:00Z' },                                    // 1 apunte → no
    ],
  };
  const S = E._statsAgregar(E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 }), raw, '2026-09-01', '2026-09-30', hoy);
  const T = S.turnos;
  check('5 turnos pasados: se hacen 2 (4 personas el 15 por la mañana; 3 apuntes el 6) y no se hacen 3', T.pasados === 5 && T.salieron === 2 && T.noSalieron === 3 && T.programados === 5, `${T.pasados}/${T.salieron}/${T.noSalieron}/${T.programados}`);
  check('el turno del 15 con 2 bajas (queda 1 persona) NO cuenta como hecho: salen adelante 40 %, no 100 %', T.pctSalen === 40, T.pctSalen + '');
  check('turnos confirmados = solo los de 3 o más personas (2), incluido el formado solo por apuntes', T.confirmados === 2 && T.confPasados === 2, `${T.confirmados}/${T.confPasados}`);
  check('desglose de los que no se hicieron: los tres tienen 1 o 2 personas ("menos de 3"), ninguno a cero', T.debiles === 3 && T.sinNadie === 0 && T.sinCubrir === 0, `${T.debiles}/${T.sinNadie}/${T.sinCubrir}`);
  check('el turno formado solo por apuntes con 3 sale adelante "por apuntes"', T.creadosOk === 1 && T.salenPorApuntes >= 1);
  // Si además se cae la última persona, pasa a "sin nadie"
  const raw2 = { ...raw, bajas: [...raw.bajas, { voluntario_id: 'g', fecha: '2026-09-15', rango: RT, registrado_en: '2026-09-15T08:00:00Z', activa: true }] };
  const S2 = E._statsAgregar(E._statsBase(raw2, { MIN_EQ: 3, IDEAL: 4 }), raw2, '2026-09-01', '2026-09-30', hoy);
  check('si se da de baja también la tercera persona: el turno queda a cero ("sin nadie")', S2.turnos.sinNadie === 1 && S2.turnos.caidos === 1 && S2.turnos.debiles === 2);
  // El criterio usa el mínimo de las reglas (MIN_EQ)
  const S3 = E._statsAgregar(E._statsBase(raw, { MIN_EQ: 2, IDEAL: 4 }), raw, '2026-09-01', '2026-09-30', hoy);
  check('con MIN_EQ = 2 el turno de 2 apuntes también se hace (el mínimo sale de Reglas del motor)', S3.turnos.salieron === 3 && S3.turnos.pctSalen === 60, `${S3.turnos.salieron}/${S3.turnos.pctSalen}`);
})();

// ── E19: turno anulado a mano (Bajas → Anular turno) ──
(function E19() {
  console.log('\n═══ E19 · Anular turno ═══');
  const hoy = '2026-09-21', RM = '10:00 a 12:00', RT = '19:00 a 21:00';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const H = (fecha, rango, id) => ({ fecha, rango, voluntario_id: id, nombre: id.toUpperCase() + ' NOMBRE' });
  const mk = origen => ({
    vols: 'abcdefg'.split('').map(V), arch: [], refs: [], bajas: [], act: null,
    hist: [...'abc'.split('').map(i => H('2026-09-15', RT, i)), ...'defg'.split('').map(i => H('2026-09-15', RM, i))],
    noReal: [{ fecha: '2026-09-15', rango: RT, motivo: 'bajas', planificados: 3, origen }],
  });
  const agg = raw => E._statsAgregar(E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 }), raw, '2026-09-01', '2026-09-30', hoy);
  const A = agg(mk('anulado')), I = agg(mk('importado'));
  check('anulado a mano con 3 voluntarios apuntados: NO cuenta como hecho (manda el anulado)', A.turnos.salieron === 1 && A.turnos.sinCubrir === 1 && A.turnos.anulados === 1 && A.turnos.programados === 2 && A.turnos.pctSalen === 50, JSON.stringify({ s: A.turnos.salieron, nc: A.turnos.sinCubrir, an: A.turnos.anulados, p: A.turnos.programados, pct: A.turnos.pctSalen }));
  check('sin anular (registro importado con gente): manda la gente y se cuenta como hecho', I.turnos.salieron === 2 && I.turnos.anulados === 0);
  check('el motivo "bajas" se refleja en el desglose', A.turnos.motivos.bajas === 1);
  check('las plazas del turno anulado no cuentan (solo las 4 del otro turno)', A.asignaciones === 4, A.asignaciones + '');
  const fila = id => A.tabla.find(r => r.id === id);
  check('quienes estaban en el turno anulado no suman asistencia (A: 0 turnos); los del otro sí (D: 1)', fila('a').turnos === 0 && fila('a').total === 0 && fila('a').ultimo === null && fila('d').turnos === 1);
  check('los turnos confirmados excluyen el anulado', A.turnos.confirmados === 1);
  // Ficha
  const F = E._fichaModelo({ hist: [{ fecha: '2026-09-15', rango: RT }], arch: [], bajas: [], refs: [], disp: [], media60: 1, anulados: new Set(['2026-09-15|' + RT]) }, hoy);
  const F0 = E._fichaModelo({ hist: [{ fecha: '2026-09-15', rango: RT }], arch: [], bajas: [], refs: [], disp: [], media60: 1 }, hoy);
  check('ficha: un turno anulado no cuenta como turno hecho (0 frente a 1 sin anular)', F.hechos === 0 && F0.hechos === 1);
  // En vivo
  const M = E._evModelo({ vols: [], hist: [...'abc'.split('').map(i => ({ ...H('2026-10-07', RT, i), tiene_llave: false })) ], bajas: [], refs: [], cal: [], anulRows: [{ fecha: '2026-10-07', rango: RT }] }, '2026-10-05', { MIN_EQ: 3, IDEAL: 4 });
  const t = M.turnos[0];
  check('En vivo: el turno anulado sale en gris, sin "atención"', t.anulado === true && t.nivel === 'gris' && t.atencion === false);
  const M2 = E._evModelo({ vols: [], hist: [...'ab'.split('').map(i => ({ ...H('2026-10-07', RT, i), tiene_llave: false }))], bajas: [], refs: [], cal: [], anulRows: [] }, '2026-10-05', { MIN_EQ: 3, IDEAL: 4 });
  check('En vivo: sin anular, el mismo turno con solo 2 sí pide atención', M2.turnos[0].atencion === true && M2.turnos[0].anulado === false);
})();

// ── E20: disponibilidad y conexión horaria ──
(function E20() {
  console.log('\n═══ E20 · Conexión horaria entre voluntarios ═══');
  check('horas cubiertas por completo: 10-13 → 10, 11, 12', E._dispoHoras('10:00 a 13:00', 8, 22).join() === '10,11,12');
  check('con minutos: 09:30 a 12:30 → 10 y 11 (solo horas completas)', E._dispoHoras('09:30 a 12:30', 8, 22).join() === '10,11');
  check('se recorta al horario de trabajo (8-22)', E._dispoHoras('06:00 a 09:00', 8, 22).join() === '8' && E._dispoHoras('20:00 a 23:00', 8, 22).join() === '20,21');
  check('horario vacío o mal escrito → ninguna hora', E._dispoHoras('', 8, 22).length === 0 && E._dispoHoras('mañanas', 8, 22).length === 0);

  const vols = 'abcdef'.split('').map(id => ({ id, nombre: id.toUpperCase() + ' NOMBRE' }));
  const disp = [
    ...'abc'.split('').map(id => ({ voluntario_id: id, dia: 'Sabado', horario: '10:00 a 14:00' })),
    { voluntario_id: 'd', dia: 'Sábado', horario: '10:00 a 12:00' },            // con tilde: se normaliza
    { voluntario_id: 'd', dia: 'Domingo', horario: '16:00 a 20:00' },           // solo, nadie más el domingo
    { voluntario_id: 'e', dia: 'Lunes', horario: '08:00 a 10:00' },             // solo, nadie más el lunes
    { voluntario_id: 'zz', dia: 'Lunes', horario: '08:00 a 10:00' },            // no es del grupo: se ignora
  ];
  const D = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3, nunca: new Set(['e', 'f']), dejo: new Set(['d']) });
  const x = id => D.lista.find(v => v.id === id);
  check('(sin semana en los datos = todas las semanas) A, B, C coinciden entre sí todo el sábado: conexión 100 % y "bien conectado"', x('a').pct === 100 && x('a').nivel === 'bien' && x('a').nVent === 15, JSON.stringify({ p: x('a').pct, n: x('a').nVent }));
  check('D: el sábado coincide con 3 (1 franja conectada) pero el domingo con nadie → 25 % "poco conectado"', x('d').pct === 25 && x('d').nivel === 'poco' && x('d').nVent === 20, JSON.stringify({ p: x('d').pct, n: x('d').nVent }));
  check('E: solo el lunes por la mañana y nadie más → 0 % "muy desconectado"', x('e').pct === 0 && x('e').nivel === 'aislado' && x('e').mediaOtros === 0);
  check('F sin ningún horario → "sin horario" (y se cuenta aparte)', x('f').nivel === 'sin' && x('f').pct === null && D.sinHorario === 1);
  check('el que no es del grupo (zz) no aparece', !x('zz') && D.lista.length === 6);
  check('mapa de grupo: sábado a las 10h están disponibles 4 (A, B, C, D), a las 12h solo 3', D.grupo[5][2] === 4 && D.grupo[5][4] === 3, D.grupo[5][2] + '/' + D.grupo[5][4]);
  check('en el dibujo de A, a las 10h coinciden 3 más y a las 14h no está disponible', x('a').mapa[5][2] === 3 && x('a').mapa[5][6] === -1);
  check('mejor franja: sábado de 10 a 12 con 4 voluntarios que la cubren entera', D.mejor && D.mejor.dia === 'Sáb' && D.mejor.desde === 10 && D.mejor.hasta === 12 && D.mejor.n === 4, JSON.stringify(D.mejor));
  check('resumen legible del horario', x('a').resumen === 'Sáb 10–14' && x('d').resumen === 'Sáb 10–12 · Dom 16–20', x('d').resumen);
  check('medias por grupo: participan 100 %, nunca han participado 0 % (F sin horario no cuenta)', D.medias.participa.pct === 100 && D.medias.nunca.pct === 0 && D.medias.nunca.n === 1, JSON.stringify(D.medias));
  // Encaje con los turnos que de verdad se hacen (borde oscuro): demanda = 7 días × 14 horas
  const dem = Array.from({ length: 7 }, () => new Array(14).fill(0)); dem[5][2] = 3; dem[5][3] = 3;   // sábado 10 y 11 h
  const Dd = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3, demanda: dem });
  const y = id => Dd.lista.find(v => v.id === id);
  check('encaje: A (sáb 10-14, turnos a las 10 y 11) tiene 2 de 4 horas en franjas con turnos = 50 % "medio"', y('a').pctDem === 50 && y('a').encaje === 'medio', JSON.stringify({ p: y('a').pctDem, e: y('a').encaje }));
  check('encaje: E (lunes 8-10, sin turnos ese día) = 0 % "lejos"', y('e').pctDem === 0 && y('e').encaje === 'lejos');
  check('encaje: D (sáb 10-12 con turnos; domingo sin) = 2 de 6 horas = 33 % "lejos"', y('d').pctDem === 33 && y('d').encaje === 'lejos', y('d').pctDem + '');
  check('sin horario no tiene encaje (null) y sin matriz de demanda tampoco se calcula', y('f').pctDem === null && E._dispoModelo(disp, vols, { DUR: 2, MIN: 3 }).lista[0].pctDem === null);
  const corto = E._dispoModelo([{ voluntario_id: 'a', dia: 'Lunes', horario: '10:00 a 11:00' }], [vols[0]], { DUR: 2, MIN: 3 });
  check('un tramo más corto que un turno (1 h) no permite ninguna franja: "tramos más cortos que un turno"', corto.lista[0].nivel === 'corto' && corto.lista[0].nVent === 0);
  const mas = E._dispoModelo([], vols, { DUR: 2, MIN: 3 });
  check('sin datos de disponibilidad: todos "sin horario" y sin mejor franja', mas.sinHorario === 6 && mas.mejor === null);

  // Integración con las estadísticas: solo voluntarios activos y agrupados por participación
  const V = (id, activo) => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo, creado_en: '2026-04-01T10:00:00Z' });
  const raw = { vols: [V('a', true), V('b', true), V('c', true), V('e', true), V('f', true), V('g', true), V('x', false)],
    hist: [], bajas: [], refs: [], act: null, noReal: [],
    arch: ['a', 'b', 'c'].map(id => ({ fecha: '2026-06-06', rango: '10:00 a 12:00', voluntario_id: id, nombre: id })),
    disp: [...'abc'.split('').map(id => ({ voluntario_id: id, dia: 'Sabado', horario: '10:00 a 14:00' })),
      { voluntario_id: 'e', dia: 'Lunes', horario: '08:00 a 10:00' }, { voluntario_id: 'g', dia: 'Martes', horario: '20:00 a 22:00' }, { voluntario_id: 'x', dia: 'Sabado', horario: '10:00 a 14:00' }] };
  const S = E._statsAgregar(E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4, DUR: 2 }), raw, '2026-06-01', '2026-06-30', '2026-09-21');
  const g = id => S.dispo.lista.find(v => v.id === id);
  check('en Estadísticas: 6 activos (el que está fuera del grupo no entra) y "nunca participaron" = E, F, G', S.dispo.lista.length === 6 && ['e', 'f', 'g'].every(i => g(i).grupo === 'nunca') && ['a', 'b', 'c'].every(i => g(i).grupo === 'participa'), S.dispo.lista.map(v => v.id + ':' + v.grupo).join(' '));
  const ins = E._statsInsights(S, null);
  check('recomendación: 3 de los 3 que nunca participaron tienen un horario que casi no encaja, con la mejor franja', ins.some(i => /3 de los 3 voluntarios que nunca han participado tienen un horario que casi no encaja/.test(i.titulo) && /Sáb de 10 a 12h/.test(i.accion)), ins.map(i => i.titulo).join(' | '));
  check('recomendación: 1 voluntario activo sin horario no genera aviso (mínimo 2)', !ins.some(i => /sin horario|ningún horario/.test(i.titulo)) || S.dispo.sinHorario >= 2);
})();

// ── E21: la semana del mes importa (no es lo mismo todos los martes que solo el tercero) ──
(function E21() {
  console.log('\n═══ E21 · Conexión horaria semana a semana ═══');
  check('texto de semanas: solo la 3.ª / 1.ª y 3.ª / 1.ª, 2.ª y 4.ª / todas', E._dSemTxt(new Set([2])) === 'solo la 3.ª sem.' && E._dSemTxt(new Set([0, 2])) === '1.ª y 3.ª sem.' && E._dSemTxt(new Set([0, 1, 3])) === '1.ª, 2.ª y 4.ª sem.' && E._dSemTxt(new Set([0, 1, 2, 3, 4])) === 'todas las semanas');
  const vols = 'abcdz'.split('').map(id => ({ id, nombre: id.toUpperCase() + ' NOMBRE' }));
  const M = (id, semana) => ({ voluntario_id: id, semana, dia: 'Martes', horario: '16:00 a 20:00' });
  // A solo está libre el tercer martes; B, C y D lo están las otras cuatro semanas. Ninguno coincide con A ese día.
  const disp = [M('a', 3), ...[1, 2, 4, 5].flatMap(w => ['b', 'c', 'd'].map(id => M(id, w))), { voluntario_id: 'z', dia: 'Lunes', horario: '08:00 a 10:00' }];
  const dem = Array.from({ length: 7 }, () => new Array(14).fill(0)); dem[1][8] = 1; dem[1][9] = 1; dem[1][10] = 1; dem[1][11] = 1;   // martes 16-20 con turnos
  const D = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3, demanda: dem });
  const x = id => D.lista.find(v => v.id === id);
  check('A (solo el tercer martes, y ese martes nadie más) → coincide 0 %: "muy desconectado" aunque B, C y D también tengan los martes', x('a').pct === 0 && x('a').nivel === 'aislado' && x('a').nVent === 3, JSON.stringify({ p: x('a').pct, n: x('a').nVent }));
  check('A está libre 1 de 5 semanas → constancia "pocas" y esporádico', x('a').semanas === 1 && x('a').constancia === 'pocas' && x('a').esporadico === true && x('a').recur === 20, JSON.stringify({ s: x('a').semanas, c: x('a').constancia, r: x('a').recur }));
  check('B, C, D (4 de 5 semanas, y coinciden entre ellos) → 100 % y constancia "todas"', x('b').pct === 100 && x('b').nivel === 'bien' && x('b').semanas === 4 && x('b').recur === 80 && x('b').constancia === 'todas' && !x('b').esporadico, JSON.stringify({ p: x('b').pct, r: x('b').recur }));
  check('el horario se escribe con sus semanas: "Mar 16–20 (solo la 3.ª sem.)" frente a "Mar 16–20 (1.ª, 2.ª, 4.ª y 5.ª sem.)"', x('a').resumen === 'Mar 16–20 (solo la 3.ª sem.)' && x('b').resumen === 'Mar 16–20 (1.ª, 2.ª, 4.ª y 5.ª sem.)', x('a').resumen + ' / ' + x('b').resumen);
  check('mapa de A: a las 16h del martes coinciden 0 otros y solo está libre 1 semana', x('a').mapa[1][8] === 0 && x('a').sem[1][8] === 1 && x('b').sem[1][8] === 4 && x('b').mapa[1][8] === 2, JSON.stringify([x('a').mapa[1][8], x('a').sem[1][8], x('b').mapa[1][8], x('b').sem[1][8]]));
  check('mapa de todo el grupo por semana: 16h del martes → 1 en la semana 3 (solo A), 3 en la semana 1; y la media es 2,6', D.grupoSem[2][1][8] === 1 && D.grupoSem[0][1][8] === 3 && D.grupo[1][8] === 2.6, JSON.stringify([D.grupoSem[2][1][8], D.grupoSem[0][1][8], D.grupo[1][8]]));
  check('encaje con los turnos: el martes 16-20 tiene turnos → A 100 %', x('a').pctDem === 100 && x('a').encaje === 'bien');
  check('una fila sin semana (Z, lunes 8-10) vale para las 5 semanas', x('z').semanas === 5 && x('z').recur === 100 && x('z').resumen === 'Lun 8–10');
  check('mejor franja: martes 16-18 (de media, 2,6 voluntarios la cubren cada semana)', D.mejor && D.mejor.dia === 'Mar' && D.mejor.desde === 16 && D.mejor.n === 2.6, JSON.stringify(D.mejor));
  // Comparado con juntar todas las semanas: A habría salido "bien conectado" (coincidiría con B, C y D)
  const union = disp.map(r => ({ ...r, semana: undefined }));
  const Du = E._dispoModelo(union, vols, { DUR: 2, MIN: 3 });
  check('juntando todas las semanas (el cálculo anterior) A parecía "bien conectado" al 100 %: por eso ahora se mide semana a semana', Du.lista.find(v => v.id === 'a').pct === 100 && Du.lista.find(v => v.id === 'a').nivel === 'bien');
})();

// ── E22: explicaciones en lenguaje llano (resumen, huecos, sobran y causa por voluntario) ──
(function E22() {
  console.log('\n═══ E22 · Horarios: explicaciones claras ═══');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const vols = ids.map(id => ({ id, nombre: id.toUpperCase() + ' NOMBRE' }));
  const disp = [
    ...'abcd'.split('').map(id => ({ voluntario_id: id, dia: 'Sabado', horario: '10:00 a 14:00' })),      // sábado por la mañana: 4 voluntarios
    { voluntario_id: 'e', dia: 'Martes', horario: '16:00 a 20:00' },                                        // martes tarde: solo E
    ...'ghijkl'.split('').map(id => ({ voluntario_id: id, dia: 'Lunes', horario: '08:00 a 10:00' })),     // lunes por la mañana: 6 voluntarios y nunca hay turnos
  ];
  const dem = Array.from({ length: 7 }, () => new Array(14).fill(0));
  [2, 3, 4, 5].forEach(i => { dem[5][i] = 2; });        // sábado 10-14 con turnos
  [8, 9, 10, 11].forEach(i => { dem[1][i] = 1; });      // martes 16-20 con turnos
  [2, 3].forEach(i => { dem[4][i] = 1; });              // viernes 10-12 con turnos (y nadie libre)
  const D = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3, demanda: dem, nunca: new Set(['e', 'f', 'g']) });
  const x = id => D.lista.find(v => v.id === id);
  check('cuándo se hacen turnos, en texto: sábado 10–14 · martes 16–20 · viernes 10–12', D.demandaTxt === 'Sáb 10–14 · Mar 16–20 · Vie 10–12', D.demandaTxt);
  check('huecos: viernes 10–12 (0 libres) y martes 16–20 (1 libre); el sábado (4 libres) no es hueco', D.huecos.length === 2 && D.huecos[0].dia === 'Vie' && D.huecos[0].desde === 10 && D.huecos[0].hasta === 12 && D.huecos[0].libres === 0 && D.huecos[1].dia === 'Mar' && D.huecos[1].desde === 16 && D.huecos[1].hasta === 20 && D.huecos[1].libres === 1, JSON.stringify(D.huecos));
  check('sobran: lunes 8–10 con 6 voluntarios libres y ningún turno', D.sobran.length === 1 && D.sobran[0].dia === 'Lun' && D.sobran[0].desde === 8 && D.sobran[0].hasta === 10 && D.sobran[0].libres === 6, JSON.stringify(D.sobran));
  check('causa de A–D: "Su horario no es el problema" (coinciden y caen donde hay turnos)', ['a', 'b', 'c', 'd'].every(i => x(i).diag.tipo === 'ok' && x(i).diag.nivel === 'verde' && x(i).diag.icono === '🟢'));
  check('causa de E: solo él el martes → "Casi nadie coincide con él", con frase que lo explica', x('e').diag.tipo === 'poco' && x('e').diag.titulo === 'Casi nadie coincide con él' && /no coincide con ningún otro voluntario/.test(x('e').diag.detalle) && /hacen falta 2 para llegar a 3/.test(x('e').diag.detalle), x('e').diag.detalle);
  check('causa de F: sin horario → "Sin horario registrado" (rojo)', x('f').diag.tipo === 'sinHorario' && x('f').diag.nivel === 'rojo' && /no puede contar con él/.test(x('f').diag.detalle));
  check('causa de G–L: coinciden entre ellos pero su horario cae lejos de los turnos → "lejos", con el % y dónde se hacen turnos', x('g').diag.tipo === 'lejos' && x('g').diag.nivel === 'ambar' && /Solo el 0 % de sus horas libres/.test(x('g').diag.detalle) && /Sáb 10–14/.test(x('g').diag.detalle), x('g').diag.detalle);
  check('cuentas por causa en los que nunca han participado (E, F, G): 1 sin horario, 1 poco, 1 lejos', JSON.stringify(D.motivos.nunca) === JSON.stringify({ poco: 1, sinHorario: 1, lejos: 1 }) || (D.motivos.nunca.poco === 1 && D.motivos.nunca.sinHorario === 1 && D.motivos.nunca.lejos === 1), JSON.stringify(D.motivos.nunca));
  const lineas = E._dResumenLineas(D).join(' | ');
  check('el resumen dice cuándo se hacen turnos, dónde faltan voluntarios y dónde sobran', /Cuándo se hacen turnos:<\/b> sobre todo Sáb 10–14/.test(lineas) && /Faltan voluntarios en franjas donde sí hay turnos:<\/b> Vie 10–12h/.test(lineas) && /Sobran voluntarios libres donde nunca hay turnos:<\/b> Lun 8–10h/.test(lineas), lineas);
  check('el resumen cuenta a los que no tienen horario y por qué no participan los que nunca lo han hecho', /1 voluntario del grupo no tiene horario registrado/.test(lineas) && /De los 3 que nunca han participado:<\/b> 1 sin horario registrado, 1 con horario lejos de los turnos, 1 que coincide poco con otros/.test(lineas), lineas);
  // Sin datos de turnos (demanda) no se inventan huecos ni "lejos"
  const Dn = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3 });
  check('sin datos de turnos no se inventan huecos, sobrantes ni "horario lejos de los turnos"', Dn.huecos.length === 0 && Dn.sobran.length === 0 && Dn.demandaTxt === '' && Dn.lista.every(v => v.diag.tipo !== 'lejos'));
  // Un voluntario con tramos de 1 hora
  const Dc = E._dispoModelo([{ voluntario_id: 'a', dia: 'Lunes', horario: '10:00 a 11:00' }], [vols[0]], { DUR: 2, MIN: 3 });
  check('tramos de 1 hora: causa "Sus tramos libres son demasiado cortos"', Dc.lista[0].diag.tipo === 'corto' && /menos de 2 horas seguidas/.test(Dc.lista[0].diag.detalle));
  // Solo una semana al mes
  const De = E._dispoModelo([{ voluntario_id: 'a', semana: 3, dia: 'Martes', horario: '16:00 a 20:00' }, ...'bcd'.split('').map(id => ({ voluntario_id: id, semana: 3, dia: 'Martes', horario: '16:00 a 20:00' }))], vols.slice(0, 4), { DUR: 2, MIN: 3 });
  check('libre solo la 3.ª semana (aunque los demás coincidan ese día): causa "Libre solo unas pocas semanas al mes"', De.lista[0].diag.tipo === 'esporadico' && /una sola semana/.test(De.lista[0].diag.detalle) && /solo la 3\.ª sem\./.test(De.lista[0].diag.detalle), De.lista[0].diag.detalle);
})();

// ── E23: recuperar apuntes y bajas desde el chat exportado de Telegram ──
(function E23() {
  console.log('\n═══ E23 · Importar desde Telegram ═══');
  const T = (t) => E._tgParsearTexto(t);
  check('apunte a turno: "✋ Nuevo apunte / NOMBRE se ha apuntado — turno 10:00 a 12:00 del 12/07/2026"', JSON.stringify(T('✋ Nuevo apunte\nANA PEREZ se ha apuntado — turno 10:00 a 12:00 del 12/07/2026\n10/07 09:15')) === JSON.stringify({ tipo: 'apunte', nombre: 'ANA PEREZ', fecha: '2026-07-12', rango: '10:00 a 12:00', dc: false }), JSON.stringify(T('✋ Nuevo apunte\nANA PEREZ se ha apuntado — turno 10:00 a 12:00 del 12/07/2026')));
  const dc = T('📅 Apunte nuevo día\nLUIS MARTIN se ha apuntado — disponible todo el día del 13/07/2026');
  check('apunte de día completo ("Apunte nuevo día" / "disponible todo el día")', dc.tipo === 'apunte' && dc.dc === true && dc.rango === null && dc.fecha === '2026-07-13');
  check('baja: "📤 Baja comunicada / NOMBRE no puede asistir — 10:00 a 12:00 del 15/07/2026"', T('📤 Baja comunicada\nLUIS MARTIN no puede asistir — 10:00 a 12:00 del 15/07/2026').tipo === 'baja');
  check('avisos nuevos del servidor: apunte cancelado y baja anulada', T('❌ Apunte cancelado\nANA PEREZ ya no cubre — 10:00 a 12:00 del 12/07/2026').tipo === 'apunte_cancelado' && T('↩️ Baja anulada\nANA PEREZ vuelve a asistir — 10:00 a 12:00 del 12/07/2026').tipo === 'baja_anulada');
  check('un aviso de baja sin franja ("turno del …") se detecta pero no se puede usar', T('📤 Baja comunicada\nX no puede asistir — turno del 14/07/2026').sinFranja === true);
  check('mensajes que no son del bot no se confunden', T('hola, ¿qué tal?') === null && T('ANA se ha apuntado — turno 10:00 a 12:00 del 12/07/2026') === null && T('') === null);
  check('los nombres con emoji o tildes delante/detrás se limpian: "🙂 MARÍA DÍAZ"', T('✋ Nuevo apunte\n🙂 MARÍA DÍAZ se ha apuntado — turno 09:00 a 11:00 del 05/09/2026').nombre === 'MARÍA DÍAZ');
  check('fecha imposible (31/02) se ignora', T('✋ Nuevo apunte\nANA se ha apuntado — turno 10:00 a 12:00 del 31/02/2026') === null);
  check('texto exportado como lista de trozos con formato (negrita/cursiva)', E._tgTexto({ text: ['✋ ', { type: 'bold', text: 'Nuevo apunte' }, '\nANA PEREZ se ha apuntado — turno 10:00 a 12:00 del 12/07/2026\n', { type: 'italic', text: '10/07 09:15' }] }).includes('Nuevo apunte\nANA PEREZ se ha apuntado'));

  // Chat de prueba
  const u = iso => String(Date.parse(iso) / 1000);
  const msg = (iso, id, texto) => ({ id, type: 'message', date: iso.slice(0, 19), date_unixtime: u(iso), from: 'Bot', text: texto });
  const ap = (n, tramo, f) => `✋ Nuevo apunte\n${n} se ha apuntado — turno ${tramo} del ${f}\n10/07 09:15`;
  const chat = { name: 'Mi bot', type: 'personal_chat', messages: [
    msg('2026-07-10T07:15:00Z', 1, ap('ANA PEREZ', '10:00 a 12:00', '12/07/2026')),
    msg('2026-07-10T07:20:00Z', 2, [{ type: 'plain', text: '✋ ' }, { type: 'bold', text: 'Nuevo apunte' }, { type: 'plain', text: '\nMARIA DIAZ se ha apuntado — turno 10:00 a 12:00 del 12/07/2026' }]),   // con formato
    msg('2026-07-10T08:00:00Z', 3, ap('LUIS MARTIN', '10:00 a 12:00', '12/07/2026')),
    msg('2026-07-10T08:05:00Z', 4, ap('LUIS MARTIN', '10:00 a 12:00', '12/07/2026')),          // aviso repetido (app abierta en dos sitios)
    msg('2026-07-11T09:00:00Z', 5, ap('PEDRO RUIZ', '10:00 a 12:00', '12/07/2026')),
    msg('2026-07-11T10:00:00Z', 6, '📤 Baja comunicada\nLUIS MARTIN no puede asistir — 10:00 a 12:00 del 12/07/2026'),   // LUIS se da de baja después de apuntarse
    msg('2026-07-11T11:00:00Z', 7, '❌ Apunte cancelado\nPEDRO RUIZ ya no cubre — 10:00 a 12:00 del 12/07/2026'),          // PEDRO cancela
    msg('2026-07-12T07:00:00Z', 8, ap('ANA PEREZ', '19:00 a 21:00', '13/07/2026')),
    msg('2026-07-12T07:01:00Z', 9, ap('MARIA DIAZ', '19:00 a 21:00', '13/07/2026')),
    msg('2026-07-12T07:02:00Z', 10, ap('LUIS MARTIN', '19:00 a 21:00', '13/07/2026')),
    msg('2026-07-12T07:03:00Z', 11, ap('CARLOS INVENTADO', '19:00 a 21:00', '13/07/2026')),   // nombre que no está en la lista
    msg('2026-07-12T08:00:00Z', 12, '📅 Apunte nuevo día\nLUIS MARTIN se ha apuntado — disponible todo el día del 14/07/2026'),
    msg('2026-07-13T08:00:00Z', 13, '📤 Baja comunicada\nX no puede asistir — turno del 14/07/2026'),   // sin franja
    { id: 14, type: 'service', date: '2026-07-13T09:00:00', text: '' },
    msg('2026-07-13T09:30:00Z', 15, 'buenos días'),
    msg('2026-09-20T09:00:00Z', 16, ap('ANA PEREZ', '10:00 a 12:00', '26/09/2026')),                // turno del mes actual: se ignora
  ] };
  const P = E._tgParsear(chat);
  check('lee el chat: 16 mensajes, 13 avisos utilizables + 1 sin franja, del 10/07 al 20/09', P.mensajes === 16 && P.eventos.length === 13 && P.sinFranja === 1 && P.desde === '2026-07-10' && P.hasta === '2026-09-20', `${P.mensajes}/${P.eventos.length}/${P.sinFranja}/${P.desde}/${P.hasta}`);
  const C = E._tgConsolidar(P.eventos);
  check('consolida: el aviso repetido se une, el apunte cancelado se quita → 9 apuntes, 1 baja', C.cont.apuntes === 9 && C.cont.bajas === 1 && C.cont.repetidos === 1 && C.cont.cancelados === 1, JSON.stringify(C.cont));
  check('se conserva la hora del PRIMER aviso del apunte repetido', C.apuntes.find(a => a.nombre === 'LUIS MARTIN' && a.rango === '10:00 a 12:00').ts === '2026-07-10T08:00:00.000Z');
  check('una baja anulada después deja la baja como no activa', E._tgConsolidar([...P.eventos, { tipo: 'baja_anulada', nombre: 'LUIS MARTIN', fecha: '2026-07-12', rango: '10:00 a 12:00', dc: false, ts: '2026-07-11T12:00:00.000Z' }]).bajas[0].activa === false);
  // Apuntarse otra vez después de cancelar vuelve a contar
  const reap = E._tgConsolidar([{ tipo: 'apunte', nombre: 'A B', fecha: '2026-07-12', rango: '10:00 a 12:00', dc: false, ts: '2026-07-01T00:00:00Z' }, { tipo: 'apunte_cancelado', nombre: 'A B', fecha: '2026-07-12', rango: '10:00 a 12:00', dc: false, ts: '2026-07-02T00:00:00Z' }, { tipo: 'apunte', nombre: 'A B', fecha: '2026-07-12', rango: '10:00 a 12:00', dc: false, ts: '2026-07-03T00:00:00Z' }]);
  check('apuntarse, cancelar y volver a apuntarse deja 1 apunte', reap.apuntes.length === 1 && reap.apuntes[0].ts === '2026-07-03T00:00:00Z');

  const vols = [{ id: '1', nombre: 'ANA PEREZ' }, { id: '2', nombre: 'LUIS MARTIN' }, { id: '3', nombre: 'MARIA DIAZ' }, { id: '4', nombre: 'PEDRO RUIZ' }];
  const hoy = '2026-09-21';
  const yaMaria = new Set(['3|2026-07-13|19:00 a 21:00|0']);
  let plan = E._tgPlan(C, vols, { ap: new Set(yaMaria), ba: new Set() }, hoy, {});
  check('plan: el aviso del mes actual queda fuera y lo que ya existe no se duplica (María el 13/07)', plan.fuera === 1 && plan.duplicados === 1, `${plan.fuera}/${plan.duplicados}`);
  check('plan: 7 apuntes nuevos (ANA×2, MARIA×1, LUIS×3 incl. día completo) sin CARLOS (dudoso) y 1 baja', plan.apuntes.length === 6 && plan.bajas.length === 1, `${plan.apuntes.length}/${plan.bajas.length}`);
  check('el nombre que no está en la lista queda por resolver, sin inventar', plan.sinResolver.length === 1 && plan.sinResolver[0].txt === 'CARLOS INVENTADO');
  check('registro de apunte con el formato de la tabla: voluntario, fecha, franja, día completo, hora del aviso, origen', JSON.stringify(plan.apuntes.find(a => a.es_dia_completo)) === JSON.stringify({ voluntario_id: '2', fecha: '2026-07-14', rango: null, es_dia_completo: true, registrado_en: '2026-07-12T08:00:00.000Z', origen: 'telegram' }), JSON.stringify(plan.apuntes.find(a => a.es_dia_completo)));
  check('vista previa por mes: julio con 6 apuntes, 1 baja y turnos que llegan a 3', plan.porMes['2026-07'] && plan.porMes['2026-07'].apuntes === 6 && plan.porMes['2026-07'].bajas === 1, JSON.stringify(plan.porMes));
  check('turno 12/07: ANA y MARIA (LUIS se dio de baja después y PEDRO canceló) = 2 → no llega a 3; turno 13/07 con ANA y LUIS (María ya existía) = 2', plan.turnosN === 2 && plan.turnosHechos === 0, `${plan.turnosN}/${plan.turnosHechos}`);
  plan = E._tgPlan(C, vols, { ap: new Set(), ba: new Set() }, hoy, { 'CARLOS INVENTADO': '__nuevo__' });
  check('sin duplicados previos y con CARLOS añadido como voluntario fuera del grupo: el turno del 13/07 llega a 4 y se cuenta como hecho', plan.nuevos.length === 1 && plan.nuevos[0].nombre === 'CARLOS INVENTADO' && plan.turnosN === 2 && plan.turnosHechos === 1 && plan.apuntes.some(a => a.voluntario_id === 'nuevo:CARLOS INVENTADO'), `${plan.nuevos.length}/${plan.turnosN}/${plan.turnosHechos}`);
  plan = E._tgPlan(C, vols, { ap: new Set(), ba: new Set() }, hoy, { 'CARLOS INVENTADO': '' });
  check('omitir a una persona la deja fuera sin error', plan.sinResolver.length === 0 && !plan.apuntes.some(a => String(a.voluntario_id).startsWith('nuevo')));
  check('un JSON de exportación completa (varios chats) también se lee', E._tgParsear({ chats: { list: [{ messages: chat.messages.slice(0, 3) }, { messages: chat.messages.slice(3, 6) }] } }).eventos.length === 6, E._tgParsear({ chats: { list: [{ messages: chat.messages.slice(0, 3) }, { messages: chat.messages.slice(3, 6) }] } }).eventos.length + '');
  check('un archivo que no es un chat no rompe: 0 avisos', E._tgParsear({}).eventos.length === 0 && E._tgParsear({ messages: [] }).mensajes === 0);
})();

// ── E24: un mes hecho solo con apuntes (como julio y agosto): asistencia, bajas posteriores y estado del mes ──
(function E24() {
  console.log('\n═══ E24 · Meses hechos solo con apuntes ═══');
  const hoy = '2026-09-21', R1 = '10:00 a 12:00';
  const V = id => ({ id, nombre: id.toUpperCase() + ' NOMBRE', tiene_llave: false, activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const AP = (id, fecha, ts) => ({ voluntario_id: id, fecha, rango: R1, es_dia_completo: false, registrado_en: ts });
  const raw = {
    vols: 'abcdef'.split('').map(V), hist: [], arch: [], noReal: [], act: null,
    refs: [
      AP('a', '2026-07-12', '2026-07-10T08:00:00Z'), AP('b', '2026-07-12', '2026-07-10T08:00:00Z'), AP('c', '2026-07-12', '2026-07-10T08:00:00Z'),
      AP('d', '2026-07-12', '2026-07-10T08:00:00Z'),        // D se apunta y DESPUÉS se da de baja → no está
      AP('e', '2026-07-12', '2026-07-11T08:00:00Z'),        // E se dio de baja y DESPUÉS se vuelve a apuntar → está
      AP('f', '2026-07-19', '2026-07-15T08:00:00Z'),        // turno de 19/07: solo F → no llega a 3
    ],
    bajas: [{ voluntario_id: 'd', fecha: '2026-07-12', rango: R1, registrado_en: '2026-07-11T08:00:00Z', activa: true }, { voluntario_id: 'e', fecha: '2026-07-12', rango: R1, registrado_en: '2026-07-10T08:00:00Z', activa: true }],
  };
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const S = E._statsAgregar(base, raw, '2026-07-01', '2026-07-31', hoy);
  const T = S.turnos, V_ = S.voluntarios;
  const t12 = base.turnos.find(t => t.k === '2026-07-12|' + R1);
  check('turno formado solo por apuntes: A, B, C y E están; D (baja posterior) no → 4 presentes', t12.n === 4 && t12.presentes.sort().join() === 'a,b,c,e', t12.presentes.join());
  check('se hizo (4 ≥ 3): turno confirmado y "recuperado por apuntes" (tras la baja de D llega a 3 gracias a los apuntes)', T.confirmados === 1 && T.salieron === 1 && T.salvados === 1 && T.salenPorApuntes === 1, JSON.stringify({ c: T.confirmados, s: T.salieron, sal: T.salvados }));
  check('el turno del 19/07 con un solo apuntado no se hizo: 1 de 2 salen adelante (50 %)', T.noSalieron === 1 && T.programados === 2 && T.pctSalen === 50 && T.debiles === 1, JSON.stringify({ n: T.noSalieron, p: T.programados, pct: T.pctSalen }));
  check('asisten los apuntados de turnos que se hicieron (A, B, C, E) y no D ni F', V_.participantes === 4 && ['a', 'b', 'c', 'e'].every(i => S.tabla.find(r => r.id === i).turnos === 1) && S.tabla.find(r => r.id === 'f').turnos === 0 && S.tabla.find(r => r.id === 'd').turnos === 0);
  check('su último turno es el 12/07 y los que no asistieron no tienen ninguno', S.tabla.find(r => r.id === 'a').ultimo === '2026-07-12' && S.tabla.find(r => r.id === 'f').ultimo === null);
  check('julio sin cuadrante pero con apuntes es un mes "con registro", no un hueco', S.cobertura.meses[0].estado === 'app' && S.cobertura.vacios.length === 0 && base.datosMeses.includes('2026-07'), JSON.stringify(S.cobertura.meses[0]));
  check('la baja de D cuenta (1 baja real) y el apunte de E que vuelve tras su baja no', t12.bajaReal === 1 && S.bajas.total === 2 && S.bajas.efectivas === 2);
  // Sin marcas de tiempo (datos antiguos): se entiende que quien tiene baja y apunte vuelve, como antes
  const sinTs = { ...raw, refs: raw.refs.map(r => ({ ...r, registrado_en: undefined })), bajas: raw.bajas.map(b => ({ ...b, registrado_en: undefined })) };
  const t12b = E._statsBase(sinTs, { MIN_EQ: 3 }).turnos.find(t => t.k === '2026-07-12|' + R1);
  check('sin fechas de aviso, baja + apunte = vuelve (compatibilidad): D y E están → 5', t12b.n === 5);
  // Un equipo confirmado + apuntados que se dan de baja después
  const raw2 = { vols: 'abcde'.split('').map(V), arch: [], noReal: [], act: null,
    hist: 'abc'.split('').map(id => ({ fecha: '2026-07-12', rango: R1, voluntario_id: id, nombre: id })),
    refs: [AP('d', '2026-07-12', '2026-07-01T00:00:00Z'), AP('e', '2026-07-12', '2026-07-01T00:00:00Z')],
    bajas: [{ voluntario_id: 'e', fecha: '2026-07-12', rango: R1, registrado_en: '2026-07-05T00:00:00Z', activa: true }] };
  const b2 = E._statsBase(raw2, { MIN_EQ: 3 }); const x = b2.turnos[0];
  check('con equipo confirmado (A, B, C) y dos apuntados (D y E, que se da de baja después): asisten A, B, C, D', x.n === 4 && x.asisten.sort().join() === 'a,b,c,d', x.asisten.join());
})();

// ── E25: meses marcados a mano como "sin actividad" o "sin datos que recuperar" ──
(function E25() {
  console.log('\n═══ E25 · Meses marcados a mano ═══');
  const hoy = '2026-09-21';
  check('mes sin datos y sin marca = hueco ("vacio")', E._stEstadoMes(null, '2026-08', hoy, false, false, null) === 'vacio');
  check('marcado "sin_actividad" = "sinact"; "sin_datos" = "sindatos"', E._stEstadoMes(null, '2026-08', hoy, false, false, 'sin_actividad') === 'sinact' && E._stEstadoMes(null, '2026-07', hoy, false, false, 'sin_datos') === 'sindatos');
  check('una marca no tapa un mes que sí tiene datos', E._stEstadoMes({ asig: 4, bajas: 1, apuntes: 0 }, '2026-07', hoy, false, false, 'sin_actividad') === 'app');
  check('el mes en curso sigue siendo "futuro" aunque tenga marca', E._stEstadoMes(null, '2026-09', hoy, false, false, 'sin_actividad') === 'futuro');
  const V = id => ({ id, nombre: id.toUpperCase(), activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const raw = { vols: ['a', 'b', 'c'].map(V), hist: ['a', 'b', 'c'].map(id => ({ fecha: '2026-06-10', rango: '10:00 a 12:00', voluntario_id: id, nombre: id })), arch: [], refs: [], bajas: [], noReal: [], act: null,
    ajustes: [{ mes: '2026-07', bajas_min: 0, nota: null, marca: 'sin_datos' }, { mes: '2026-08', bajas_min: 0, nota: null, marca: 'sin_actividad' }] };
  const S = E._statsAgregar(E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 }), raw, '2026-07-01', '2026-08-31', hoy);
  check('julio y agosto marcados dejan de ser huecos y quedan como marcados', S.cobertura.vacios.length === 0 && S.cobertura.marcados.length === 2 && S.cobertura.meses.map(m => m.estado).join() === 'sindatos,sinact', JSON.stringify(S.cobertura.meses.map(m => m.estado)));
  const raw0 = { ...raw, ajustes: [] };
  const S0 = E._statsAgregar(E._statsBase(raw0, { MIN_EQ: 3 }), raw0, '2026-07-01', '2026-08-31', hoy);
  check('sin las marcas, esos dos meses sí salen como huecos', S0.cobertura.vacios.length === 2);
  check('un ajuste con 0 bajas y solo marca no cuenta como "bajas indicadas"', S.cobertura.meses.every(m => m.estimadas === 0));
})();

// ── E26: cómo salió un turno, indicado a mano (gracias a apuntes / cuántos asistieron) y estadística global ──
(function E26() {
  console.log('\n═══ E26 · Turnos indicados a mano ═══');
  const hoy = '2026-09-21', R1 = '10:00 a 12:00', R2 = '19:00 a 21:00';
  const V = id => ({ id, nombre: id.toUpperCase(), activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const H = (fecha, rango, ids) => ids.map(id => ({ fecha, rango, voluntario_id: id, nombre: id }));
  const raw = {
    vols: 'abcdefg'.split('').map(V), arch: [], refs: [], bajas: [], noReal: [], act: null,
    hist: [...H('2026-06-10', R1, ['a', 'b', 'c']), ...H('2026-06-17', R1, ['a', 'b', 'c']), ...H('2026-06-24', R2, ['a', 'b']), ...H('2026-07-08', R1, ['d', 'e', 'f'])],
    resultados: [
      { id: 1, fecha: '2026-06-10', rango: R1, por_apuntes: true, asistentes: null },     // se iba a caer y lo salvaron los apuntes
      { id: 2, fecha: '2026-06-17', rango: R1, por_apuntes: false, asistentes: 4 },        // 3 confirmados y acabaron siendo 4
      { id: 3, fecha: '2026-06-24', rango: R2, por_apuntes: true, asistentes: 3 },         // con 2 en el registro, vinieron 3 gracias a apuntes
      { id: 4, fecha: '2026-12-01', rango: R1, por_apuntes: true, asistentes: 5 },         // turno que no existe: se ignora
    ] };
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const t = k => base.turnos.find(x => x.k === k);
  const t1 = t('2026-06-10|' + R1), t2 = t('2026-06-17|' + R1), t3 = t('2026-06-24|' + R2), t4 = t('2026-07-08|' + R1);
  check('«salió gracias a apuntes» marcado a mano: cuenta como salvado por apuntes y con baja', t1.salvado === true && t1.conBaja === true && t1.apuntesManual === true && t1.n === 3);
  check('«asistieron 4» sube el número de personas (de 3 a 4) sin marcarlo como apuntes', t2.n === 4 && t2.nReg === 3 && !t2.salvado && !t2.apuntesManual);
  check('indicar 3 asistentes en un turno con 2 en el registro lo convierte en turno hecho (2 → 3)', t3.nReg === 2 && t3.n === 3 && t3.salvado === true);
  check('sin nada indicado, el turno se queda como consta en el registro', t4.n === 3 && !t4.salvado && !t4.res);
  check('un resultado para un turno que no existe se ignora (no crea turnos fantasma)', base.turnos.length === 4 && !base.turnos.some(x => x.fecha === '2026-12-01'));
  const G = E._stApuntesGlobal(base, hoy);
  check('estadística global: 4 turnos realizados, 2 gracias a los apuntes (50 %), los dos indicados a mano', G.hechos === 4 && G.porApuntes === 2 && G.pct === 50 && G.manual === 2, JSON.stringify(G));
  check('desglose por mes: junio 3 realizados y 2 por apuntes; julio 1 y 0', JSON.stringify(G.meses.map(m => [m.k, m.hechos, m.porApuntes])) === '[["2026-06",3,2],["2026-07",1,0]]', JSON.stringify(G.meses));
  const S = E._statsAgregar(base, raw, '2026-06-01', '2026-07-31', hoy);
  check('el periodo lo refleja: salen adelante por apuntes = 2 y el turno con 4 cuenta como "completo"', S.turnos.salenPorApuntes === 2 && S.turnos.completos === 1 && S.turnos.salvados === 2, JSON.stringify({ s: S.turnos.salenPorApuntes, c: S.turnos.completos }));
  const Gp = E._stApuntesGlobal(E._statsBase({ ...raw, hist: raw.hist, resultados: [{ id: 9, fecha: '2026-06-24', rango: R2, por_apuntes: true, asistentes: 2 }] }, { MIN_EQ: 3 }), hoy);
  check('marcar «gracias a apuntes» pero con menos de 3 asistentes no cuenta (el turno no se hizo)', Gp.porApuntes === 0 && Gp.hechos === 3, JSON.stringify(Gp));
  // Un turno formado solo por apuntes (sin equipo) se cuenta por el registro, sin marca
  const rawAp = { vols: 'abc'.split('').map(V), arch: [], hist: [], noReal: [], act: null, bajas: [], resultados: [],
    refs: 'abc'.split('').map(id => ({ voluntario_id: id, fecha: '2026-07-12', rango: R1, es_dia_completo: false, registrado_en: '2026-07-10T00:00:00Z' })) };
  const Ga = E._stApuntesGlobal(E._statsBase(rawAp, { MIN_EQ: 3 }), hoy);
  check('un turno formado solo por apuntes cuenta como salido gracias a apuntes sin marca manual', Ga.hechos === 1 && Ga.porApuntes === 1 && Ga.manual === 0);
  check('los turnos futuros no entran en el histórico', E._stApuntesGlobal(base, '2026-06-15').hechos === 1);
})();

// ── E27: dos maneras de salir gracias a apuntes: salvado tras baja vs solo disponible en apuntes ──
(function E27() {
  console.log('\n═══ E27 · Salvado por apuntes vs solo en apuntes ═══');
  const hoy = '2026-09-21', R1 = '10:00 a 12:00';
  const V = id => ({ id, nombre: id.toUpperCase(), activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const H = (fecha, ids) => ids.map(id => ({ fecha, rango: R1, voluntario_id: id, nombre: id }));
  const raw = { vols: 'abcdef'.split('').map(V), arch: [], refs: [], bajas: [], noReal: [], act: null,
    hist: [...H('2026-06-02', ['a', 'b', 'c']), ...H('2026-06-09', ['a', 'b', 'c']), ...H('2026-06-16', ['a', 'b', 'c']), ...H('2026-06-23', ['a', 'b', 'c'])],
    resultados: [
      { id: 1, fecha: '2026-06-02', rango: R1, por_apuntes: true, tipo: 'salvado', asistentes: null },
      { id: 2, fecha: '2026-06-09', rango: R1, por_apuntes: true, tipo: 'solo_apuntes', asistentes: null },
      { id: 3, fecha: '2026-06-16', rango: R1, por_apuntes: true, tipo: null, asistentes: null },        // filas antiguas sin tipo = salvado
    ] };
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const t = d => base.turnos.find(x => x.k === d + '|' + R1);
  check('«salvado»: se iba a caer por bajas, cuenta como salvado y con baja, no como solo apuntes', t('2026-06-02').salvado && t('2026-06-02').conBaja && !t('2026-06-02').creadoOk && t('2026-06-02').tipoManual === 'salvado');
  check('«solo en apuntes»: cuenta como salido solo con apuntes, no como salvado ni como turno con baja', t('2026-06-09').creadoOk && t('2026-06-09').creadoPorApuntes && !t('2026-06-09').salvado && !t('2026-06-09').conBaja && t('2026-06-09').tipoManual === 'solo_apuntes');
  check('una marca antigua sin tipo se entiende como «salvado»', t('2026-06-16').tipoManual === 'salvado' && t('2026-06-16').salvado);
  const G = E._stApuntesGlobal(base, hoy);
  check('global: 4 realizados, 2 salvados, 1 solo en apuntes, total 3 gracias a apuntes (75 %)', G.hechos === 4 && G.salvados === 2 && G.soloApuntes === 1 && G.porApuntes === 3 && G.pct === 75, JSON.stringify(G));
  check('por mes: junio 4 realizados, 2 salvados y 1 solo apuntes', G.meses.length === 1 && G.meses[0].salvados === 2 && G.meses[0].soloApuntes === 1 && G.meses[0].porApuntes === 3);
  const S = E._statsAgregar(base, raw, '2026-06-01', '2026-06-30', hoy);
  check('el periodo separa "salvados tras baja" (2) de "sin equipo previo" (1)', S.turnos.salvados === 2 && S.turnos.creadosOk === 1 && S.turnos.salenPorApuntes === 3, JSON.stringify({ s: S.turnos.salvados, c: S.turnos.creadosOk }));
  const raw2 = { ...raw, resultados: [{ id: 1, fecha: '2026-06-09', rango: R1, por_apuntes: true, tipo: 'solo_apuntes', asistentes: 2 }] };
  check('«solo en apuntes» con menos de 3 asistentes no cuenta como realizado', E._stApuntesGlobal(E._statsBase(raw2, { MIN_EQ: 3 }), hoy).soloApuntes === 0);
})();

// ── E28: franjas alternativas (🔀) que nadie cubrió no cuentan como turno perdido ──
(function E28() {
  console.log('\n═══ E28 · Turnos alternativos ═══');
  const hoy = '2026-09-21', R1 = '10:00 a 12:00', R2 = '19:00 a 21:00';
  const V = id => ({ id, nombre: id.toUpperCase(), activo: true, creado_en: '2026-05-01T10:00:00Z' });
  const raw = { vols: 'abcd'.split('').map(V), arch: [], noReal: [], act: null,
    hist: [{ fecha: '2026-06-09', rango: R2, voluntario_id: 'a', nombre: 'a' }, { fecha: '2026-06-09', rango: R2, voluntario_id: 'b', nombre: 'b' }, { fecha: '2026-06-09', rango: R2, voluntario_id: 'c', nombre: 'c' }],
    // 02/06 alternativa sin nadie; 16/06 alternativa con 1 apuntado (no llega a 3); 23/06 alternativa que SÍ se cubre; 09/06 normal, no alternativa
    refs: [{ voluntario_id: 'd', fecha: '2026-06-16', rango: R1, es_dia_completo: false, registrado_en: '2026-06-01T00:00:00Z' }],
    bajas: [{ voluntario_id: 'a', fecha: '2026-06-02', rango: R1, registrado_en: '2026-06-01T00:00:00Z', activa: true }],
    alternativos: ['2026-06-02|' + R1, '2026-06-16|' + R1, '2026-06-23|' + R1] };
  raw.hist.push({ fecha: '2026-06-23', rango: R1, voluntario_id: 'a', nombre: 'a' }, { fecha: '2026-06-23', rango: R1, voluntario_id: 'b', nombre: 'b' }, { fecha: '2026-06-23', rango: R1, voluntario_id: 'c', nombre: 'c' });
  const base = E._statsBase(raw, { MIN_EQ: 3, IDEAL: 4 });
  const t = k => base.turnos.find(x => x.k === k);
  check('una alternativa que nadie cubrió se marca como tal pero sigue existiendo en la base', t('2026-06-02|' + R1).alternativo === true && t('2026-06-02|' + R1).n === 0);
  check('una alternativa con 1 apuntado (no llega al mínimo) también queda marcada', t('2026-06-16|' + R1).alternativo === true && t('2026-06-16|' + R1).n === 1);
  check('una alternativa que sí se cubre queda marcada igual (no se excluye si sale adelante)', t('2026-06-23|' + R1).alternativo === true && t('2026-06-23|' + R1).n === 3);
  check('un turno normal (no marcado en el calendario) no es alternativo', t('2026-06-09|' + R2).alternativo === false);
  const S = E._statsAgregar(base, raw, '2026-06-01', '2026-06-30', hoy);
  check('las dos alternativas que no llegaron al mínimo no cuentan ni como programadas ni como perdidas: solo quedan el turno normal y la alternativa que sí se cubrió', S.turnos.programados === 2 && S.turnos.confirmados === 2 && S.turnos.noSalieron === 0, JSON.stringify({ p: S.turnos.programados, c: S.turnos.confirmados, ns: S.turnos.noSalieron }));
  check('se avisa de cuántas alternativas quedaron fuera por transparencia (2)', S.turnos.alternativosOmitidos === 2);
  check('las dos franjas contables quedan como turno normal (justos, 3 de 4)', S.turnos.justos === 2);
  // Sin ninguna marcada como alternativa (raw.alternativos vacío o ausente), nada cambia
  const raw2 = { ...raw, alternativos: [] };
  const S2 = E._statsAgregar(E._statsBase(raw2, { MIN_EQ: 3, IDEAL: 4 }), raw2, '2026-06-01', '2026-06-30', hoy);
  check('sin marcar nada como alternativo, las franjas vacías sí cuentan como no realizadas (comportamiento de siempre)', S2.turnos.programados === 4 && S2.turnos.alternativosOmitidos === 0, JSON.stringify(S2.turnos.programados));
})();

// ── E29: la disponibilidad de los portadores de llave prioriza para fijar un turno ──
(function E29() {
  console.log('\n═══ E29 · Huérfanos de horario y prioridad de la llave ═══');
  // A, B, C coinciden todo el sábado (10-14, ninguno con llave) → sin llave nadie puede fijar el turno.
  // D, E, F coinciden todo el domingo (10-14) y D tiene llave → ahí sí se puede fijar.
  // G está solo el lunes, sin nadie más (huérfano de verdad, la llave no cambia nada).
  const vols = [
    { id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }, { id: 'c', nombre: 'C' },
    { id: 'd', nombre: 'D', tiene_llave: true }, { id: 'e', nombre: 'E' }, { id: 'f', nombre: 'F' },
    { id: 'g', nombre: 'G' },
  ];
  const disp = [
    ...'abc'.split('').map(id => ({ voluntario_id: id, dia: 'Sabado', horario: '10:00 a 14:00' })),
    ...'def'.split('').map(id => ({ voluntario_id: id, dia: 'Domingo', horario: '10:00 a 14:00' })),
    { voluntario_id: 'g', dia: 'Lunes', horario: '10:00 a 12:00' },
  ];
  const dem = Array.from({ length: 7 }, () => new Array(14).fill(0));
  [2, 3, 4, 5].forEach(i => { dem[5][i] = 1; dem[6][i] = 1; });   // sábado y domingo con turnos
  [2, 3].forEach(i => { dem[0][i] = 1; });                          // lunes también, para que G no salga "lejos" por no coincidir con la demanda
  const D = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3, demanda: dem });
  const x = id => D.lista.find(v => v.id === id);

  check('sin tener en cuenta la llave (comportamiento de siempre): A coincide bien, "su horario no es el problema"', x('a').diag.tipo === 'ok' && x('a').pct === 100, JSON.stringify({ t: x('a').diag.tipo, p: x('a').pct }));
  check('teniendo en cuenta la llave: A, B y C coinciden pero NADIE lleva llave → "sin llave cerca", no "ok"', x('a').diagLlave.tipo === 'sinLlaveCerca' && x('a').pctLlave === 0 && x('a').nivelLlave !== 'bien', JSON.stringify({ t: x('a').diagLlave.tipo, p: x('a').pctLlave }));
  check('D, E y F coinciden Y hay llave (la tiene D) → con o sin priorizar la llave, "su horario no es el problema"', x('e').diag.tipo === 'ok' && x('e').diagLlave.tipo === 'ok' && x('e').pctLlave === 100, JSON.stringify({ t: x('e').diagLlave.tipo, p: x('e').pctLlave }));
  check('D es portador de llave: su propia llave ya cuenta, no hace falta que sea "otro"', x('d').tieneLlave === true && x('d').diagLlave.tipo === 'ok');
  check('G, huérfano de verdad (nadie coincide con él): la llave no cambia el diagnóstico, sigue "poco"/"aislado" en ambas vistas', ['poco', 'aislado'].includes(x('g').diag.tipo) && ['poco', 'aislado'].includes(x('g').diagLlave.tipo), JSON.stringify({ p: x('g').diag.tipo, l: x('g').diagLlave.tipo }));
  check('huecosLlave: el sábado (gente de sobra, cero llaves) sale como hueco de llave; el domingo (con D) no', D.huecosLlave.length === 1 && D.huecosLlave[0].dia === 'Sáb', JSON.stringify(D.huecosLlave));
  check('D.motivosLlave cuenta a A, B y C como sinLlaveCerca (participan, no "nunca")', D.motivosLlave.participa.sinLlaveCerca === 3, JSON.stringify(D.motivosLlave));

  const sinLlave = E._dResumenLineas(D, true).join(' | ');
  check('con la llave activada, el resumen avisa de la franja sin portador de llave', /Hay gente de sobra, pero sin nadie que lleve llave/.test(sinLlave) && /Sáb/.test(sinLlave), sinLlave);
  const conLlaveApagada = E._dResumenLineas(D, false).join(' | ');
  check('con la llave desactivada (comportamiento de siempre), no aparece ese aviso', !/sin nadie que lleve llave/.test(conLlaveApagada));
  const porDefecto = E._dResumenLineas(D).join(' | ');
  check('llamar a _dResumenLineas sin el segundo argumento se comporta exactamente igual que antes (compatibilidad)', porDefecto === conLlaveApagada);

  // Sin ningún portador de llave en todo el grupo, la vista con llave no rompe nada, solo lo marca todo
  const sinNadieLlave = vols.map(v => ({ ...v, tiene_llave: false }));
  const D2 = E._dispoModelo(disp, sinNadieLlave, { DUR: 2, MIN: 3, demanda: dem });
  check('si nadie del grupo tiene llave, la vista normal no cambia pero la de llave marca todo como sin llave cerca', D2.lista.find(v => v.id === 'e').diag.tipo === 'ok' && D2.lista.find(v => v.id === 'e').diagLlave.tipo === 'sinLlaveCerca');
})();

// ── E30: el dibujo de cada voluntario también refleja la prioridad de la llave ──
(function E30() {
  console.log('\n═══ E30 · Dibujo individual con la llave ═══');
  const vols = [
    { id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }, { id: 'c', nombre: 'C' },
    { id: 'd', nombre: 'D', tiene_llave: true }, { id: 'e', nombre: 'E' }, { id: 'f', nombre: 'F' },
  ];
  const disp = [
    ...'abc'.split('').map(id => ({ voluntario_id: id, dia: 'Sabado', horario: '10:00 a 14:00' })),      // sábado: A,B,C coinciden, nadie con llave
    ...'def'.split('').map(id => ({ voluntario_id: id, dia: 'Domingo', horario: '10:00 a 14:00' })),     // domingo: D,E,F coinciden y D tiene llave
  ];
  const D = E._dispoModelo(disp, vols, { DUR: 2, MIN: 3 });
  const x = id => D.lista.find(v => v.id === id);
  check('mapaLlave de A (sábado, sin llave cerca) es 0 esas horas: nunca hay portador de llave', x('a').mapaLlave[5][2] === 0, JSON.stringify(x('a').mapaLlave[5]));
  check('mapaLlave de E (domingo, con D que tiene llave) es 1: siempre hay portador de llave', x('e').mapaLlave[6][2] === 1, JSON.stringify(x('e').mapaLlave[6]));
  check('mapaLlave de D (él mismo tiene llave) también es 1 en su propio horario', x('d').mapaLlave[6][2] === 1);
  const svgA_llave = E._stDispoStrip(x('a'), D, true), svgA_normal = E._stDispoStrip(x('a'), D, false);
  check('con la llave activada, el cuadro de A (sábado 10h, coincide gente pero sin llave) lleva borde morado', /stroke="#7c3aed"/.test(svgA_llave), svgA_llave.slice(0, 200));
  check('con la llave desactivada, no aparece el borde morado en el dibujo de A', !/stroke="#7c3aed"/.test(svgA_normal));
  const svgE_llave = E._stDispoStrip(x('e'), D, true);
  check('el dibujo de E (domingo, con D presente) no lleva borde morado: sí hay llave cerca', !/stroke="#7c3aed"/.test(svgE_llave));
  check('el dibujo sigue siendo un <svg> válido con el nombre en el aria-label', /<svg /.test(svgA_llave) && /aria-label="Horario de A"/.test(svgA_llave));
})();

console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
process.exit(fallos ? 1 : 0);
