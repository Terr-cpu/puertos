
--  10 · Restricción de unicidad en bajas (voluntario + fecha + rango)
--  ────────────────────────────────────────────────────────────
--  La tabla historial ya tiene esta protección (historial_voluntario_id_
--  fecha_rango_key). bajas no la tenía, y el código la guarda con
--  "resolution=merge-duplicates" — sin esta restricción, Supabase no
--  sabe qué columnas definen un duplicado (usa la clave interna, que
--  siempre es nueva), así que un mismo voluntario podía acabar con dos
--  filas de baja para el mismo turno en vez de una sola que se reactiva/
--  desactiva con la columna "activa".
--
--  Comprobado contra los datos reales antes de escribir esto: no había
--  ningún duplicado ya guardado, así que se puede añadir directamente.
--
--  Hace falta ejecutar esto una vez en el SQL Editor de Supabase — el
--  planificador solo tiene la clave publicable (anon), que no puede
--  hacer cambios de estructura (ALTER TABLE).

alter table public.bajas
  add constraint bajas_voluntario_id_fecha_rango_key
  unique (voluntario_id, fecha, rango);
