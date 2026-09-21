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
body += '\n;globalThis.__engine = { planificarMesGlobal, calcularDiaJS, _evModelo, _fichaModelo, _stPeriodo, _stEstadoMes, _impParsearLinea, _impParsear, _impEmparejar, _impPlan, _impSegmentar, _impSugerir, _impEsPrograma, _impParsearPrograma, _impFusionar, _statsBase, _statsAgregar, _statsInsights, PH, HP, franjas2h, normDia, cargarReglas, reglasLlaveConf };\n';

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
    arch: [...eq('2026-09-10', R1, 'abcde'), H('2026-05-05', R1, 'l')],   // T0 (mes anterior, archivado) + un turno antiguo de L, que no volvió
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

  check('turnos del periodo: 7 (6 pasados + 1 próximo), 6 con equipo confirmado', T.total === 7 && T.pasados === 6 && T.proximos === 1 && T.confirmados === 6, `${T.total}/${T.pasados}/${T.proximos}/${T.confirmados}`);
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
  check('participación: 7 de 11 activos = 64 % (el inactivo no cuenta)', V.participantes === 7 && V.activos === 11 && V.inactivos === 1 && V.participacion === 64, `${V.participantes}/${V.activos}/${V.participacion}`);
  check('concentración: 3 primeros = 62 %, 20 % más activo = 46 %', V.top3Share === 62 && V.top20Share === 46, `${V.top3Share}/${V.top20Share}`);
  check('dejaron de participar: solo L (turno en mayo, ninguno desde entonces)', V.sugeridos.map(r => r.id).join() === 'l', V.sugeridos.map(r => r.id).join());
  check('sin estrenar: F y J (nunca un turno hecho); K inactivo no cuenta', V.sinEstrenar.map(r => r.id).sort().join() === 'f,j', V.sinEstrenar.map(r => r.id).join());
  check('turnos confirmados desglosados: 5 ya realizados y 1 próximo', T.confPasados === 5 && T.confProg === 1, T.confPasados + '/' + T.confProg);
  const fila = id => S.tabla.find(r => r.id === id);
  check('tabla: A hizo 3 turnos y tiene llave; B 2 turnos, 1 baja sobre 3 plazas (33 %)', fila('a').turnos === 3 && fila('a').llave && fila('b').turnos === 2 && fila('b').bajas === 1 && fila('b').tasa === 33, JSON.stringify({ b: fila('b') }).slice(0, 120));
  check('último turno de E = 10/09 (el de octubre acabó en baja, el otro es el apuntado)', fila('e').ultimo === '2026-09-10');
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
  check('no salta "3 más activos" con menos de 8 participantes', !ins.some(i => /3 más activos/.test(i.titulo)));
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
  const S = E._statsAgregar(base, raw, '2026-05-01', '2026-09-30', hoy);
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
  const S2 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy);
  const est2 = Object.fromEntries(S2.cobertura.meses.map(m => [m.k, m.estado]));
  check('tras importar, jun-ago pasan a "manual" (turnos sin rastro de bajas)', est2['2026-06'] === 'manual' && est2['2026-07'] === 'manual' && est2['2026-08'] === 'manual');
  check('y ahora sí se puede afirmar que D, F y G dejaron de participar (4 meses con datos después)', S2.voluntarios.sugeridos.map(r => r.id).sort().join() === 'd,f,g' && S2.voluntarios.sinEvidencia.length === 0, S2.voluntarios.sugeridos.map(r => r.id).join());
  check('los meses manuales no diluyen la tasa: sigue sobre las 11 plazas con registro', S2.bajas.base === 11 && S2.bajas.tasa === 18.2, `${S2.bajas.base}/${S2.bajas.tasa}`);
  const S3 = E._statsAgregar(base2, raw, '2026-05-01', '2026-09-30', hoy, { mesesOk: new Set(['2026-06', '2026-07', '2026-08']) });
  check('si el usuario marca esos meses como "registro completo", pasan a contar en la tasa (20 plazas, 2 bajas = 10 %)', S3.bajas.base === 20 && S3.bajas.tasa === 10, `${S3.bajas.base}/${S3.bajas.tasa}`);

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
  check('4 turnos con gente y 6 registrados como no realizados', T.total === 4 && T.confirmados === 4 && T.sinCubrir === 6, `${T.total}/${T.confirmados}/${T.sinCubrir}`);
  check('salen adelante 4 de 10 programados = 40 %', T.salieron === 4 && T.noSalieron === 6 && T.programados === 10 && T.pctSalen === 40, `${T.salieron}/${T.noSalieron}/${T.programados}/${T.pctSalen}`);
  check('motivos: 5 sin voluntarios/otros y 1 por bajas', T.motivos['sin voluntarios'] === 4 && T.motivos.bajas === 1 && T.motivos.otro === 1, JSON.stringify(T.motivos));
  check('las franjas sin cubrir no cuentan como turnos con gente (media de personas no se hunde)', Math.abs(T.nMedia - 3) < 1e-9, T.nMedia + '');
  check('mapa: los domingos por la tarde tienen 4 sin cubrir y 0 turnos; el domingo entero suma 5', S.celdas.t[0].sinCubrir === 4 && S.celdas.t[0].turnos === 0 && S.porDia.find(d => d.dow === 0).sinCubrir === 5, `${S.celdas.t[0].sinCubrir}/${S.porDia.find(d => d.dow === 0).sinCubrir}`);
  check('la serie mensual solo cuenta turnos con gente (4)', S.meses.length === 1 && S.meses[0].turnos === 4);
  const ins = E._statsInsights(S, null), tit = ins.map(i => i.titulo).join(' | ');
  check('insight rojo: solo salen adelante 4 de 10 (40 %)', ins.some(i => i.nivel === 'rojo' && /Solo salen adelante 4 de 10/.test(i.titulo)), tit);
  check('insight: los domingos por la tarde casi nunca se cubren', ins.some(i => /domingos por la tarde casi nunca/.test(i.titulo)), tit);
  check('mayo sin bajas ni apuntes sigue siendo "manual" y con datos (tiene turnos)', S.cobertura.manuales.length === 1 && S.cobertura.vacios.length === 0);
  // un mes con SOLO turnos sin cubrir cuenta como con datos manuales, no como vacío
  check('mes con solo franjas sin cubrir (sin asignaciones) = "manual", no "vacío"', E._stEstadoMes({ asig: 0, bajas: 0, apuntes: 0, noReal: 3 }, '2026-06', hoy, false) === 'manual');
  // si un registro de no realizado coincide con un turno que sí tiene gente, manda la gente
  const raw2 = { ...raw, noReal: [{ fecha: '2026-05-02', rango: R1, motivo: 'otro', planificados: 0 }] };
  const S2 = E._statsAgregar(E._statsBase(raw2, { MIN_EQ: 3, IDEAL: 4 }), raw2, '2026-05-01', '2026-05-31', hoy);
  check('conflicto: turno con gente registrado también como no realizado → cuenta como realizado', S2.turnos.sinCubrir === 0 && S2.turnos.salieron === 4);
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

console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
process.exit(fallos ? 1 : 0);
