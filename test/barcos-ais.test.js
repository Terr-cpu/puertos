// Prueba de supabase/functions/barcos-ais/index.ts
// Carga el archivo tal cual con Supabase y aisstream (WebSocket) simulados.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FUENTE = path.join(__dirname, '..', 'supabase', 'functions', 'barcos-ais', 'index.ts');
let fallos = 0;
function check(nombre, cond, detalle) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nombre + (detalle ? ' — ' + detalle : ''));
  if (!cond) fallos++;
}

function cargar({ mensajes = [], env = {}, errorAis = null }) {
  let codigo = fs.readFileSync(FUENTE, 'utf8').replace(/^import .*$/m, '');
  codigo = stripTypeScriptTypes(codigo).replace('const ESCUCHA = 55;', 'const ESCUCHA = 0.05;')
    + '\n;globalThis.__f = { procesar, horaAis, etaAis };';
  const ops = [], enviado = [];
  const sb = {
    from(t) {
      return {
        upsert(filas, o) { ops.push({ t, op: 'upsert', filas, o }); return Promise.resolve({ error: null }); },
        insert(filas) { ops.push({ t, op: 'insert', filas }); return Promise.resolve({ error: null }); },
        delete() { return { lt(c, v) { ops.push({ t, op: 'delete', c, v }); return Promise.resolve({ error: null }); } }; },
      };
    },
  };
  class FakeWS {
    constructor(url) {
      this.url = url;
      setTimeout(() => {
        this.onopen && this.onopen();
        setTimeout(() => {
          if (errorAis) { this.onmessage({ data: JSON.stringify({ error: errorAis }) }); return; }
          for (const m of mensajes) this.onmessage({ data: JSON.stringify(m) });
        }, 1);
      }, 1);
    }
    send(t) { enviado.push(JSON.parse(t)); }
    close() { setTimeout(() => this.onclose && this.onclose(), 0); }
  }
  let handler = null;
  const entorno = { AISSTREAM_API_KEY: 'clave-ais', CRON_SECRET_RECORDATORIOS: 'sec', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', ...env };
  const ctx = {
    console, Math, JSON, Promise, Error, Response, String, Number, Date, Map, isFinite, setTimeout, clearTimeout,
    WebSocket: FakeWS, createClient: () => sb,
    Deno: { env: { get: (k) => entorno[k] }, serve: (fn) => { handler = fn; } },
  };
  vm.createContext(ctx);
  new vm.Script(codigo).runInContext(ctx);
  return { handler, ops, enviado, f: ctx.__f };
}
const llamar = (h, secret, body = {}) => h(new Request('http://x/', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {}, body: JSON.stringify(body) }));

const pos = (mmsi, nombre, lat, lon, sog, t = '2026-10-23 10:00:00.123 +0000 UTC') => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: nombre, latitude: lat, longitude: lon, time_utc: t },
  Message: { PositionReport: { Sog: sog, Cog: 45.4, TrueHeading: 44, NavigationalStatus: 0 } },
});
const est = (mmsi, nombre) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: nombre, time_utc: '2026-10-23 10:01:00 +0000 UTC' },
  Message: { ShipStaticData: { Name: nombre + '@@@', CallSign: 'ABC1 ', ImoNumber: 9000001, Type: 60,
    Dimension: { A: 150, B: 50, C: 15, D: 15 }, Destination: 'SEVILLA@@', Eta: { Month: 10, Day: 24, Hour: 7, Minute: 30 }, MaximumStaticDraught: 6.2 } },
});

(async () => {
  console.log('\n═══ barcos-ais — señal AIS de los barcos ═══');
  let r = cargar({});
  check('sin secreto → 401', (await llamar(r.handler, null)).status === 401);
  r = cargar({ env: { AISSTREAM_API_KEY: '' } });
  const sinClave = await llamar(r.handler, 'sec');
  check('sin clave de aisstream → 500 con explicación', sinClave.status === 500 && /AISSTREAM_API_KEY/.test(await sinClave.text()));

  r = cargar({
    mensajes: [
      pos(111, 'COSTA LUNA   ', 37.20, -6.08, 9.4),
      pos(111, 'COSTA LUNA', 37.10, -6.10, 9.0, '2026-10-23 09:50:00 +0000 UTC'),   // más antigua: no pisa
      est(111, 'COSTA LUNA'),
      pos(222, '', 36.80, -6.40, 0.1),
      { MessageType: 'PositionReport', MetaData: { MMSI: 0 } },                    // sin MMSI: se ignora
      'basura',
    ],
  });
  const res = await llamar(r.handler, 'sec');
  const cuerpo = JSON.parse(await res.text());
  check('se suscribe con la clave, la zona y los dos tipos de mensaje',
    r.enviado.length === 1 && r.enviado[0].APIKey === 'clave-ais' && r.enviado[0].BoundingBoxes.length === 1
    && r.enviado[0].FilterMessageTypes.includes('PositionReport') && r.enviado[0].FilterMessageTypes.includes('ShipStaticData'));
  check('responde con lo recogido', res.status === 200 && cuerpo.ok && cuerpo.barcos === 2 && cuerpo.posiciones === 2 && cuerpo.datos === 1, JSON.stringify(cuerpo));
  const ups = r.ops.filter(o => o.t === 'barcos_ais' && o.op === 'upsert');
  check('guarda posiciones y datos fijos por separado (cada uno solo sus columnas)',
    ups.length === 2 && ups.every(u => u.o.onConflict === 'mmsi')
    && ups[0].filas.every(f => 'lat' in f && !('destino' in f)) && ups[1].filas.every(f => 'destino' in f && !('lat' in f)));
  const p111 = ups[0].filas.find(f => f.mmsi === 111);
  check('la posición más nueva gana a una más antigua', p111.lat === 37.2 && p111.pos_ts === '2026-10-23T10:00:00Z');
  const e111 = ups[1].filas[0];
  check('datos fijos limpios: nombre sin @, eslora A+B, destino y ETA del barco',
    e111.nombre === 'COSTA LUNA' && e111.eslora === 200 && e111.manga === 30 && e111.destino === 'SEVILLA' && e111.eta_ais === '2026-10-24T07:30:00.000Z' && e111.tipo === 60);
  check('guarda el rastro de cada barco', r.ops.some(o => o.t === 'barcos_ais_rastro' && o.op === 'insert' && o.filas.length === 2));
  check('limpia el rastro viejo y los barcos que no se ven', r.ops.filter(o => o.op === 'delete').length === 2);

  r = cargar({ errorAis: 'Api Key Is Not Valid' });
  const mal = JSON.parse(await (await llamar(r.handler, 'sec')).text());
  check('si aisstream rechaza la clave, lo dice', mal.ok === false && /Api Key/.test(mal.error));

  const f = cargar({}).f;
  check('ETA sin año → la fecha más próxima (un 3 de enero visto el 30 de diciembre es del año siguiente)',
    f.etaAis({ Month: 1, Day: 3, Hour: 8, Minute: 0 }, new Date('2026-12-30T00:00:00Z')) === '2027-01-03T08:00:00.000Z');
  check('ETA vacía (0/0) → nada', f.etaAis({ Month: 0, Day: 0, Hour: 24, Minute: 60 }, new Date()) === null);

  console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallida(s)` : '\n✅ Todo correcto');
  process.exit(fallos ? 1 : 0);
})();
