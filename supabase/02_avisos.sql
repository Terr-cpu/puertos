-- ══════════════════════════════════════════════════════════════
--  02 · Aviso de "turno en riesgo" (Telegram)
--  ────────────────────────────────────────────────────────────
--  Cada hora, Supabase llama a la Edge Function `avisos-turnos`, que avisa por
--  Telegram de los turnos de las próximas 48 h con menos voluntarios del mínimo.
--
--  ANTES de ejecutar esto:
--   1. Desplegar la función `avisos-turnos` (ver NOTIFICACIONES.md, parte B).
--   2. Poner en su pestaña Secrets:  CRON_SECRET = un texto largo cualquiera.
--   3. Cambiar abajo  CAMBIA_ESTE_SECRETO  por ese mismo texto.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar → Run.
--  Es idempotente (se puede volver a ejecutar).
-- ══════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Qué avisos se han enviado ya (para no repetirlos). Solo la usa la función
-- con la clave de servicio: con RLS activado y sin políticas nadie más la ve.
create table if not exists public.avisos_enviados (
  clave text primary key,          -- "yyyy-mm-dd|rango"
  n     integer not null,          -- voluntarios presentes cuando se avisó
  ts    timestamptz not null default now()
);
alter table public.avisos_enviados enable row level security;

-- Se re-programan los trabajos si ya existían
select cron.unschedule(jobid) from cron.job
where jobname in ('avisos-turnos-riesgo', 'limpiar-actividad');

-- Cada hora en punto (la función solo escribe entre las 8:00 y las 21:59 de Madrid)
select cron.schedule('avisos-turnos-riesgo', '0 * * * *', $job$
  select net.http_post(
    url     := 'https://inifdflvblnonzowbxie.supabase.co/functions/v1/avisos-turnos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CAMBIA_ESTE_SECRETO'),
    body    := '{}'::jsonb
  );
$job$);

-- Limpieza: el registro de actividad (01_actividad.sql) solo guarda 90 días.
-- Si aún no has ejecutado 01_actividad.sql, este trabajo simplemente no encontrará la tabla.
select cron.schedule('limpiar-actividad', '30 3 * * *', $job$
  delete from public.actividad where ts < now() - interval '90 days';
$job$);

-- ── Comprobaciones útiles ─────────────────────────────────────
--  Ver que están programados:      select jobname, schedule from cron.job;
--  Ver los últimos disparos:       select * from cron.job_run_details order by start_time desc limit 5;
--  Ver las respuestas de la función: select id, status_code, content from net._http_response order by id desc limit 5;
