-- ══════════════════════════════════════════════════════════════
--  16_registro_avisos.sql — Registro de los correos enviados a los voluntarios
--  ────────────────────────────────────────────────────────────
--  Las funciones notificar-email y recordatorios-turnos anotan aquí cada correo
--  que envían (o intentan enviar): a quién, de qué tipo, el asunto y si Resend lo
--  aceptó. El planificador lo muestra en Inicio → "Avisos enviados".
--
--  Solo lo puede leer el admin; escriben las funciones (clave de servidor).
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar → Run.
--  Después, volver a desplegar notificar-email y recordatorios-turnos.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.registro_avisos (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null default now(),
  canal         text not null default 'correo',
  tipo          text not null,      -- baja | turno_confirmado | turno_quitado | recordatorio | disponibilidad | prueba
  voluntario_id uuid,
  nombre        text,
  destino       text,
  asunto        text,
  ok            boolean not null default true,
  detalle       text
);
create index if not exists registro_avisos_ts_idx on public.registro_avisos (ts desc);

alter table public.registro_avisos enable row level security;
drop policy if exists admin_lee on public.registro_avisos;
create policy admin_lee on public.registro_avisos for select to authenticated using (public.es_admin());

-- Para que no crezca sin límite, se puede borrar de vez en cuando lo de más de 6 meses:
--   delete from public.registro_avisos where ts < now() - interval '6 months';
