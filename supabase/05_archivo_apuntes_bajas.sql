-- ══════════════════════════════════════════════════════════════
--  05 · Archivo de apuntes y bajas de meses anteriores
--  ────────────────────────────────────────────────────────────
--  Para recuperar los apuntes y bajas de meses que ya no están en `refuerzos` /
--  `bajas` (p. ej. julio y agosto), reconstruidos desde los avisos de Telegram
--  (Estadísticas → 📥 Importar → 💬 Desde Telegram).
--
--  Son tablas APARTE a propósito: `refuerzos` y `bajas` tienen avisos automáticos a
--  Telegram y disparadores (01_actividad.sql). Si la historia antigua se metiera
--  ahí, mandaría un aviso por cada fila. Estas no tienen ninguno.
--  Las estadísticas leen las dos.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.apuntes_archivo (
  id              bigint generated always as identity primary key,
  voluntario_id   uuid not null,
  fecha           text not null,                       -- fecha del turno (yyyy-mm-dd)
  rango           text,                                -- "10:00 a 12:00"; nulo si es "disponible todo el día"
  es_dia_completo boolean not null default false,
  registrado_en   timestamptz not null default now(),  -- cuándo se apuntó (hora del aviso de Telegram)
  origen          text not null default 'telegram'
);
create unique index if not exists apuntes_archivo_uq
  on public.apuntes_archivo (voluntario_id, fecha, coalesce(rango, ''), es_dia_completo);
create index if not exists apuntes_archivo_fecha_idx on public.apuntes_archivo (fecha);

create table if not exists public.bajas_archivo (
  id            bigint generated always as identity primary key,
  voluntario_id uuid not null,
  fecha         text not null,
  rango         text,
  registrado_en timestamptz not null default now(),    -- cuándo comunicó la baja (hora del aviso de Telegram)
  activa        boolean not null default true,         -- false = la baja se anuló después
  origen        text not null default 'telegram'
);
create unique index if not exists bajas_archivo_uq
  on public.bajas_archivo (voluntario_id, fecha, coalesce(rango, ''));
create index if not exists bajas_archivo_fecha_idx on public.bajas_archivo (fecha);

-- Como el resto de tablas de la app: se lee y se escribe con la clave pública (no hay inicio de sesión).
alter table public.apuntes_archivo enable row level security;
alter table public.bajas_archivo   enable row level security;

drop policy if exists apa_lectura   on public.apuntes_archivo;
drop policy if exists apa_insertar  on public.apuntes_archivo;
drop policy if exists apa_modificar on public.apuntes_archivo;
drop policy if exists apa_borrar    on public.apuntes_archivo;
create policy apa_lectura   on public.apuntes_archivo for select to anon, authenticated using (true);
create policy apa_insertar  on public.apuntes_archivo for insert to anon, authenticated with check (true);
create policy apa_modificar on public.apuntes_archivo for update to anon, authenticated using (true) with check (true);
create policy apa_borrar    on public.apuntes_archivo for delete to anon, authenticated using (true);

drop policy if exists baa_lectura   on public.bajas_archivo;
drop policy if exists baa_insertar  on public.bajas_archivo;
drop policy if exists baa_modificar on public.bajas_archivo;
drop policy if exists baa_borrar    on public.bajas_archivo;
create policy baa_lectura   on public.bajas_archivo for select to anon, authenticated using (true);
create policy baa_insertar  on public.bajas_archivo for insert to anon, authenticated with check (true);
create policy baa_modificar on public.bajas_archivo for update to anon, authenticated using (true) with check (true);
create policy baa_borrar    on public.bajas_archivo for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.apuntes_archivo to anon, authenticated;
grant select, insert, update, delete on public.bajas_archivo    to anon, authenticated;
grant usage, select on sequence public.apuntes_archivo_id_seq to anon, authenticated;
grant usage, select on sequence public.bajas_archivo_id_seq   to anon, authenticated;

-- Comprobación: deben devolver 0 filas y no dar error
--   select * from public.apuntes_archivo;
--   select * from public.bajas_archivo;
