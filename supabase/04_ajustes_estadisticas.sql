-- ══════════════════════════════════════════════════════════════
--  04 · Ajustes manuales de las estadísticas por mes
--  ────────────────────────────────────────────────────────────
--  Para meses gestionados fuera de la app de los que no se conservan las bajas
--  una a una, pero se sabe que hubo "al menos N". Las estadísticas usan ese
--  mínimo como dato aproximado (las cifras salen como "≥ N").
--
--  Se rellena desde Estadísticas → 🩺 Calidad de los datos → ✎ Indicar bajas.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.ajustes_estadisticas (
  mes            text primary key,                    -- "2026-04"
  bajas_min      integer not null default 0 check (bajas_min >= 0),  -- turnos con baja, como mínimo
  nota           text,
  actualizado_en timestamptz not null default now()
);

-- Como el resto de tablas de la app: se lee y escribe con la clave pública
-- (no hay inicio de sesión). Solo contiene un mes, un número y una nota.
alter table public.ajustes_estadisticas enable row level security;

drop policy if exists aje_lectura   on public.ajustes_estadisticas;
drop policy if exists aje_insertar  on public.ajustes_estadisticas;
drop policy if exists aje_modificar on public.ajustes_estadisticas;
drop policy if exists aje_borrar    on public.ajustes_estadisticas;
create policy aje_lectura   on public.ajustes_estadisticas for select to anon, authenticated using (true);
create policy aje_insertar  on public.ajustes_estadisticas for insert to anon, authenticated with check (true);
create policy aje_modificar on public.ajustes_estadisticas for update to anon, authenticated using (true) with check (true);
create policy aje_borrar    on public.ajustes_estadisticas for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.ajustes_estadisticas to anon, authenticated;

-- Comprobación: debe devolver 0 filas y no dar error
--   select * from public.ajustes_estadisticas;
