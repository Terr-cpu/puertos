-- ══════════════════════════════════════════════════════════════
--  09 · Copia de seguridad de la disponibilidad actual
--  ────────────────────────────────────────────────────────────
--  Antes de seguir probando el formulario nuevo (disponibilidad-bloques.html), guarda una
--  foto de cómo está la tabla `disponibilidad` ahora mismo, por si hiciera falta recuperarla.
--  Se llevó por delante la de Manuel Fernández el 2026-09-27 (guardado que falló a mitad, ya
--  corregido: ver 08_disponibilidad_bloques.sql), así que conviene tener redes de seguridad.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede volver a ejecutar más adelante para renovar la copia (borra la tabla de respaldo
--  y la vuelve a crear con los datos de ese momento) — no es idempotente respecto a guardar
--  copias antiguas: cada ejecución SUSTITUYE la copia anterior, no la acumula.
-- ══════════════════════════════════════════════════════════════

drop table if exists public.disponibilidad_respaldo;

create table public.disponibilidad_respaldo as
select *, now() as respaldado_en
from public.disponibilidad;

alter table public.disponibilidad_respaldo enable row level security;

drop policy if exists dre_lectura on public.disponibilidad_respaldo;
create policy dre_lectura on public.disponibilidad_respaldo for select to anon, authenticated using (true);
grant select on public.disponibilidad_respaldo to anon, authenticated;
-- Sin insert/update/delete a propósito: es una copia de solo lectura, no una tabla de trabajo.

-- Comprobación: debe devolver 429 filas (o las que haya en ese momento) con la columna respaldado_en
--   select count(*), max(respaldado_en) from public.disponibilidad_respaldo;

-- ── Cómo restaurar, si hiciera falta ──
-- 1. Para un voluntario concreto (sustituye SU_ID):
--      delete from public.disponibilidad where voluntario_id = 'SU_ID';
--      insert into public.disponibilidad (voluntario_id, semana, dia, horario)
--        select voluntario_id, semana, dia, horario
--        from public.disponibilidad_respaldo where voluntario_id = 'SU_ID';
-- 2. Para restaurar TODA la tabla a como estaba en el respaldo (solo en caso de emergencia):
--      truncate public.disponibilidad;
--      insert into public.disponibilidad (voluntario_id, semana, dia, horario)
--        select voluntario_id, semana, dia, horario from public.disponibilidad_respaldo;
