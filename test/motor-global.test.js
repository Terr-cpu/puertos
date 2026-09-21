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
body += '\n;globalThis.__engine = { planificarMesGlobal, calcularDiaJS, _evModelo, _fichaModelo, PH, HP, franjas2h, normDia, cargarReglas, reglasLlaveConf };\n';

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

console.log('\n' + (fallos ? `❌ ${fallos} comprobación(es) fallida(s)` : '✅ Todas las comprobaciones OK'));
process.exit(fallos ? 1 : 0);
