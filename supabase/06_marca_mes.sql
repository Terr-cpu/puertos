-- ══════════════════════════════════════════════════════════════
--  06 · Marcar un mes como "sin actividad" o "sin datos que recuperar"
--  ────────────────────────────────────────────────────────────
--  Añade una columna a `ajustes_estadisticas` (ver 04) para que un mes sin datos
--  en la app deje de avisarse como hueco:
--    sin_actividad → ese mes no hubo turnos
--    sin_datos     → hubo turnos, pero no queda ningún registro
--  Se usa desde Estadísticas → 🩺 Calidad de los datos.
--
--  Requiere haber ejecutado antes 04_ajustes_estadisticas.sql.
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

alter table public.ajustes_estadisticas
  add column if not exists marca text;

alter table public.ajustes_estadisticas
  drop constraint if exists ajustes_estadisticas_marca_chk;
alter table public.ajustes_estadisticas
  add constraint ajustes_estadisticas_marca_chk check (marca is null or marca in ('sin_actividad', 'sin_datos'));

-- Comprobación: debe devolver la columna "marca"
--   select mes, bajas_min, marca from public.ajustes_estadisticas;
