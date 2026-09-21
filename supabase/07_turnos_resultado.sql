-- ══════════════════════════════════════════════════════════════
--  07 · Cómo salió un turno (indicado a mano)
--  ────────────────────────────────────────────────────────────
--  Para turnos de meses gestionados fuera de la app (o cuyo registro no cuenta lo que pasó):
--    por_apuntes → el turno se iba a caer por las bajas y salió gracias a los apuntes
--    asistentes  → cuántas personas vinieron en total (p. ej. 3 confirmados y acabaron siendo 4)
--  Las estadísticas lo usan por encima de lo que muestre el registro.
--
--  Se rellena desde Estadísticas → 🩺 Calidad de los datos → 🧾 Turnos, o desde
--  «🙋 Turnos que salieron gracias a los apuntes».
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.turnos_resultado (
  id             bigint generated always as identity primary key,
  fecha          text not null,                                   -- yyyy-mm-dd
  rango          text not null,                                   -- "10:00 a 12:00"
  por_apuntes    boolean not null default false,
  asistentes     integer check (asistentes is null or (asistentes >= 0 and asistentes <= 50)),
  nota           text,
  actualizado_en timestamptz not null default now(),
  unique (fecha, rango)
);

alter table public.turnos_resultado enable row level security;

drop policy if exists tre_lectura   on public.turnos_resultado;
drop policy if exists tre_insertar  on public.turnos_resultado;
drop policy if exists tre_modificar on public.turnos_resultado;
drop policy if exists tre_borrar    on public.turnos_resultado;
create policy tre_lectura   on public.turnos_resultado for select to anon, authenticated using (true);
create policy tre_insertar  on public.turnos_resultado for insert to anon, authenticated with check (true);
create policy tre_modificar on public.turnos_resultado for update to anon, authenticated using (true) with check (true);
create policy tre_borrar    on public.turnos_resultado for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.turnos_resultado to anon, authenticated;
grant usage, select on sequence public.turnos_resultado_id_seq to anon, authenticated;

-- Comprobación: debe devolver 0 filas y no dar error
--   select * from public.turnos_resultado;
