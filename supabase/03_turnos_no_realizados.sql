-- ══════════════════════════════════════════════════════════════
--  03 · Turnos que no salieron adelante
--  ────────────────────────────────────────────────────────────
--  Guarda las franjas que se habilitaron pero NO se hicieron: sin ningún
--  voluntario apuntado, o canceladas (por bajas, por el barco, etc.). Sirve para
--  las estadísticas: qué porcentaje de turnos salen adelante y qué días/franjas
--  se quedan más veces sin cubrir.
--
--  Las filas las crea la app al importar cuadrantes anteriores
--  (Estadísticas → 📥 Importar turnos anteriores).
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.turnos_no_realizados (
  id           bigint generated always as identity primary key,
  fecha        text not null,                          -- yyyy-mm-dd
  rango        text not null,                          -- "10:00 a 12:00"
  motivo       text not null default 'sin voluntarios', -- sin voluntarios | bajas | otro
  planificados integer not null default 0,             -- personas que estaban previstas
  origen       text not null default 'importado',      -- importado | manual
  creado_en    timestamptz not null default now(),
  unique (fecha, rango)
);

create index if not exists turnos_no_realizados_fecha_idx on public.turnos_no_realizados (fecha);

-- Igual que el resto de tablas de la app, se lee y se escribe con la clave pública
-- (la app no tiene inicio de sesión). Solo contiene fechas y franjas, sin nombres.
alter table public.turnos_no_realizados enable row level security;

drop policy if exists tnr_lectura   on public.turnos_no_realizados;
drop policy if exists tnr_insertar  on public.turnos_no_realizados;
drop policy if exists tnr_modificar on public.turnos_no_realizados;
drop policy if exists tnr_borrar    on public.turnos_no_realizados;
create policy tnr_lectura   on public.turnos_no_realizados for select to anon, authenticated using (true);
create policy tnr_insertar  on public.turnos_no_realizados for insert to anon, authenticated with check (true);
create policy tnr_modificar on public.turnos_no_realizados for update to anon, authenticated using (true) with check (true);
create policy tnr_borrar    on public.turnos_no_realizados for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.turnos_no_realizados to anon, authenticated;
grant usage, select on sequence public.turnos_no_realizados_id_seq to anon, authenticated;

-- Comprobación: debe devolver 0 filas y no dar error
--   select * from public.turnos_no_realizados;
