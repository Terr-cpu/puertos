-- ══════════════════════════════════════════════════════════════
--  12 · Avisos por correo a los voluntarios
--  ────────────────────────────────────────────────────────────
--  Email de cada voluntario (lo introduce el coordinador desde la ficha del
--  planificador) + la tabla de control de recordatorios diarios.
--
--  ANTES de ejecutar esto:
--   1. Desplegar las funciones `notificar-email` y `recordatorios-turnos`
--      (ver NOTIFICACIONES.md, Ampliación I).
--   2. En `recordatorios-turnos` → Secrets → CRON_SECRET_RECORDATORIOS = un texto largo.
--      (nombre propio, no "CRON_SECRET" — ese ya lo usa avisos-turnos y los secrets
--      son por proyecto, no por función; reutilizarlo rompería ese aviso)
--   3. Cambiar abajo CAMBIA_ESTE_SECRETO por ese mismo texto.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar → Run.
--  Es idempotente (se puede volver a ejecutar).
-- ══════════════════════════════════════════════════════════════

alter table public.voluntarios add column if not exists email text;

-- Qué recordatorios diarios ya se han mandado (para no duplicar si el cron
-- se reintenta el mismo día). Solo la usa la función con la clave de servicio.
create table if not exists public.recordatorios_enviados (
  clave text primary key,  -- "voluntario_id|fecha"
  ts    timestamptz not null default now()
);
alter table public.recordatorios_enviados enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'recordatorios-turnos';

-- Una vez al día. 19:00 UTC ≈ 20:00/21:00 en Madrid según horario de verano —
-- ajusta la hora si quieres que llegue más temprano o más tarde.
select cron.schedule('recordatorios-turnos', '0 19 * * *', $job$
  select net.http_post(
    url     := 'https://inifdflvblnonzowbxie.supabase.co/functions/v1/recordatorios-turnos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CAMBIA_ESTE_SECRETO'),
    body    := '{}'::jsonb
  );
$job$);

-- ── Comprobación rápida ───────────────────────────────────────
--  select jobname, schedule from cron.job where jobname = 'recordatorios-turnos';
--  select email from public.voluntarios limit 5;  -- debe existir sin error
