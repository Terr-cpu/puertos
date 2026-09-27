-- ══════════════════════════════════════════════════════════════
--  08 · Permitir varios bloques de disponibilidad el mismo día
--  ────────────────────────────────────────────────────────────
--  La tabla `disponibilidad` solo permitía UNA fila por voluntario, semana y día — venía
--  del formulario antiguo, que guardaba un único rango de horas por día. El nuevo formulario
--  por bloques (disponibilidad-bloques.html: Mañana/Mediodía/Tarde/Noche) guarda una fila por
--  cada bloque marcado, así que en cuanto alguien marca dos bloques no contiguos el mismo día
--  (p. ej. Mañana y Noche, sin Mediodía ni Tarde), la restricción antigua lo rechaza con
--  "duplicate key value violates unique constraint disponibilidad_voluntario_id_semana_dia_key".
--
--  El resto de la app ya está preparado para varias filas por día — tanto el motor de
--  planificación (dispoIdx) como las estadísticas (_dispoModelo) suman todas las filas de un
--  voluntario sin más; nunca asumieron una sola. Solo había que ajustar la restricción.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

alter table public.disponibilidad
  drop constraint if exists disponibilidad_voluntario_id_semana_dia_key;

alter table public.disponibilidad
  drop constraint if exists disponibilidad_voluntario_id_semana_dia_horario_key;
alter table public.disponibilidad
  add constraint disponibilidad_voluntario_id_semana_dia_horario_key
  unique (voluntario_id, semana, dia, horario);

-- Comprobación: debe seguir devolviendo las filas de siempre sin error
--   select voluntario_id, semana, dia, horario from public.disponibilidad limit 5;
