-- ══════════════════════════════════════════════════════════════
--  17 · Barcos en vivo (AIS)
--  ────────────────────────────────────────────────────────────
--  La función barcos-ais se conecta cada 5 minutos a aisstream.io durante
--  un minuto, recoge la señal AIS de los barcos del Golfo de Cádiz y del
--  Guadalquivir y la guarda aquí. El planificador lo enseña en "🚢 Barcos en vivo".
--
--  Antes de ejecutar esto:
--   1. Crear la clave gratuita en https://aisstream.io (entrar con GitHub → API Keys).
--   2. Supabase → Edge Functions → Secrets → AISSTREAM_API_KEY = esa clave.
--   3. Desplegar la función barcos-ais (supabase/functions/barcos-ais/index.ts).
--  Luego: SQL Editor → pegar todo esto → Run.
-- ══════════════════════════════════════════════════════════════

-- Última posición y datos de cada barco (uno por MMSI, el número AIS del barco)
create table if not exists public.barcos_ais (
  mmsi         bigint primary key,
  nombre       text,
  imo          bigint,
  indicativo   text,
  tipo         int,            -- tipo AIS: 60-69 pasaje/cruceros, 70-79 carga, 80-89 tanqueros…
  eslora       int,            -- metros
  manga        int,
  calado       numeric,
  destino      text,           -- lo que declara el barco (p. ej. "SEVILLA", "ESSVQ")
  eta_ais      timestamptz,    -- hora de llegada que declara el barco
  estatico_ts  timestamptz,    -- cuándo llegaron esos datos
  lat          double precision,
  lon          double precision,
  sog          numeric,        -- velocidad en nudos
  cog          numeric,        -- rumbo sobre el fondo (grados)
  rumbo        int,            -- proa (grados; 511 = no disponible)
  estado_nav   int,            -- 0 navegando, 1 fondeado, 5 amarrado…
  pos_ts       timestamptz,    -- hora de la última posición
  actualizado  timestamptz not null default now()
);
create index if not exists barcos_ais_pos_ts_idx on public.barcos_ais (pos_ts desc);

-- Rastro (para dibujar por dónde ha ido y saber si sube o baja por el río)
create table if not exists public.barcos_ais_rastro (
  id    bigint generated always as identity primary key,
  mmsi  bigint not null,
  ts    timestamptz not null,
  lat   double precision not null,
  lon   double precision not null,
  sog   numeric
);
create index if not exists barcos_ais_rastro_idx on public.barcos_ais_rastro (mmsi, ts desc);

-- Vínculos hechos a mano: "este nombre del calendario es este barco" (cuando el nombre no coincide)
create table if not exists public.barcos_alias (
  nombre  text primary key,     -- nombre del calendario, normalizado (mayúsculas, sin tildes)
  mmsi    bigint not null,
  creado  timestamptz not null default now()
);

-- Solo el administrador las ve (la función escribe con la clave de servicio)
alter table public.barcos_ais        enable row level security;
alter table public.barcos_ais_rastro enable row level security;
alter table public.barcos_alias      enable row level security;
drop policy if exists admin_lee on public.barcos_ais;
create policy admin_lee on public.barcos_ais for select to authenticated using (public.es_admin());
drop policy if exists admin_lee on public.barcos_ais_rastro;
create policy admin_lee on public.barcos_ais_rastro for select to authenticated using (public.es_admin());
drop policy if exists admin_todo on public.barcos_alias;
create policy admin_todo on public.barcos_alias for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Cada 5 minutos, con la misma clave secreta que ya usa la tarea de los recordatorios
-- (se copia de esa tarea: así no hay que volver a escribirla).
select cron.unschedule(jobid) from cron.job where jobname = 'barcos-ais';
select cron.schedule('barcos-ais', '*/5 * * * *',
  replace((select command from cron.job where jobname = 'recordatorios-turnos'),
          '/functions/v1/recordatorios-turnos', '/functions/v1/barcos-ais'));

-- ── Comprobación ───────────────────────────────────────────────
--  select jobname, schedule from cron.job where jobname in ('recordatorios-turnos', 'barcos-ais');
--  (a los 5-10 minutos)  select nombre, lat, lon, sog, pos_ts from barcos_ais order by pos_ts desc limit 20;
