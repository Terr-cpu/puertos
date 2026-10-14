-- ══════════════════════════════════════════════════════════════
--  14_cerrar_bd.sql — Cerrar la base de datos, FASE 2 del login
--  ────────────────────────────────────────────────────────────
--  Hasta ahora casi todas las tablas tenían una política "public_all" (o
--  equivalentes) que dejaba leer y escribir a CUALQUIERA con la clave pública,
--  que está en el código de las páginas. Esto lo cambia a:
--
--   · Sin sesión (anon)  → nada.
--   · Admin              → todo.
--   · Voluntario         → lee lo que necesitan Sustituciones / Disponibilidad /
--                          su menú, y solo modifica LO SUYO (sus bajas, sus
--                          apuntes, su disponibilidad y sus topes de fin de semana).
--
--  Las Edge Functions (correo, Telegram, avisos) usan la clave de servidor y no
--  les afecta. Los triggers (actividad, webhooks) tampoco.
--
--  Disponibilidad: el voluntario solo la cambia la primera vez o si el admin se lo ha
--  habilitado en su ficha (15_dispo_habilitada.sql).
--
--  EJECUTAR SOLO cuando las páginas nuevas (con login) ya estén publicadas:
--  las antiguas usan la clave pública y dejarían de funcionar.
--  Requiere haber ejecutado antes 13_login.sql.
--
--  Para deshacerlo en una emergencia: ver el final del archivo.
-- ══════════════════════════════════════════════════════════════

-- Columna de 15_dispo_habilitada.sql (por si no se ha ejecutado antes)
alter table public.voluntarios add column if not exists dispo_habilitada boolean not null default false;

-- ── 1. Quitar todas las políticas abiertas ────────────────────
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('actividad','ajustes_estadisticas','apuntes_archivo','bajas','bajas_archivo',
                        'calendario','disponibilidad','disponibilidad_respaldo','historial',
                        'historial_archivo','navieras','refuerzos','turnos_no_realizados',
                        'turnos_resultado','voluntarios')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ── 2. Admin: todo en todas ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['actividad','ajustes_estadisticas','apuntes_archivo','bajas','bajas_archivo',
                           'calendario','disponibilidad','disponibilidad_respaldo','historial',
                           'historial_archivo','navieras','refuerzos','turnos_no_realizados',
                           'turnos_resultado','voluntarios']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_todo on public.%I for all to authenticated
                    using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- ── 3. Voluntario ─────────────────────────────────────────────
-- Su propia ficha: verla y cambiar solo sus topes de fin de semana (lo controla
-- el trigger de abajo; la política deja tocar la fila, el trigger las columnas).
create policy vol_ver_mi_ficha on public.voluntarios for select to authenticated
  using (id = public.mi_voluntario_id());
create policy vol_editar_mi_ficha on public.voluntarios for update to authenticated
  using (id = public.mi_voluntario_id()) with check (id = public.mi_voluntario_id());

create or replace function public.voluntarios_solo_topes()
returns trigger
language plpgsql
as $$
begin
  -- Admin, Edge Functions (service_role) y el SQL Editor: sin restricción
  if auth.role() is distinct from 'authenticated' or public.es_admin() then
    return new;
  end if;
  if (new.id, new.nombre, new.tiene_llave, new.activo, new.email, new.creado_en)
     is distinct from (old.id, old.nombre, old.tiene_llave, old.activo, old.email, old.creado_en) then
    raise exception 'Solo puedes cambiar cuántos sábados y domingos puedes hacer';
  end if;
  -- Habilitar el cambio de disponibilidad solo lo hace el admin; el voluntario solo la
  -- vuelve a bloquear (al guardarla)
  if new.dispo_habilitada and not coalesce(old.dispo_habilitada, false) then
    raise exception 'Solo el coordinador puede habilitar el cambio de disponibilidad';
  end if;
  return new;
end;
$$;
drop trigger if exists voluntarios_solo_topes on public.voluntarios;
create trigger voluntarios_solo_topes before update on public.voluntarios
  for each row execute function public.voluntarios_solo_topes();

-- Cuadrante confirmado, apuntes y calendario: ver todo (para la oferta de turnos
-- y para contar huecos). Sin nombres: los nombres solo salen por las vistas.
create policy vol_ver on public.historial  for select to authenticated using (public.mi_voluntario_id() is not null);
create policy vol_ver on public.refuerzos  for select to authenticated using (public.mi_voluntario_id() is not null);
create policy vol_ver on public.calendario for select to authenticated using (public.mi_voluntario_id() is not null);
create policy vol_ver on public.navieras   for select to authenticated using (public.mi_voluntario_id() is not null);

-- Sus apuntes: apuntarse (insert / upsert) y desapuntarse
create policy vol_mios_insertar on public.refuerzos for insert to authenticated with check (voluntario_id = public.mi_voluntario_id());
create policy vol_mios_editar   on public.refuerzos for update to authenticated using (voluntario_id = public.mi_voluntario_id()) with check (voluntario_id = public.mi_voluntario_id());
create policy vol_mios_borrar   on public.refuerzos for delete to authenticated using (voluntario_id = public.mi_voluntario_id());

-- Sus bajas: verlas, comunicarlas y anularlas (al volver a apuntarse)
create policy vol_mias_ver      on public.bajas for select to authenticated using (voluntario_id = public.mi_voluntario_id());
create policy vol_mias_insertar on public.bajas for insert to authenticated with check (voluntario_id = public.mi_voluntario_id());
create policy vol_mias_editar   on public.bajas for update to authenticated using (voluntario_id = public.mi_voluntario_id()) with check (voluntario_id = public.mi_voluntario_id());

-- Su disponibilidad: verla siempre; cambiarla solo la primera vez (aún no tiene la nueva,
-- por bloques) o si el coordinador se lo ha habilitado (15_dispo_habilitada.sql)
create or replace function public.puede_editar_dispo()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select v.dispo_habilitada
        or (v.max_sabados is null and v.max_domingos is null
            and not exists (select 1 from public.disponibilidad d
                            where d.voluntario_id = v.id and d.horario in ('08:00 a 14:00', '16:00 a 22:00')))
    from public.voluntarios v where v.id = public.mi_voluntario_id()
  ), false)
$$;
revoke execute on function public.puede_editar_dispo() from public, anon;
grant  execute on function public.puede_editar_dispo() to authenticated;

create policy vol_mia_ver      on public.disponibilidad for select to authenticated using (voluntario_id = public.mi_voluntario_id());
create policy vol_mia_insertar on public.disponibilidad for insert to authenticated with check (voluntario_id = public.mi_voluntario_id() and public.puede_editar_dispo());
create policy vol_mia_editar   on public.disponibilidad for update to authenticated using (voluntario_id = public.mi_voluntario_id() and public.puede_editar_dispo()) with check (voluntario_id = public.mi_voluntario_id());
create policy vol_mia_borrar   on public.disponibilidad for delete to authenticated using (voluntario_id = public.mi_voluntario_id() and public.puede_editar_dispo());

-- Turnos anulados: verlos (el menú del voluntario no enseña un turno anulado)
create policy vol_ver on public.turnos_no_realizados for select to authenticated using (public.mi_voluntario_id() is not null);

-- ── 4. Vistas: solo con sesión ────────────────────────────────
-- Las vistas se ejecutan con permisos de su dueño (se saltan las políticas), así
-- que se cierran a quien no ha entrado. Con sesión dan nombres y turnos (lo mismo
-- que sale en el PDF del cuadrante), nunca correos.
revoke all on public.v_historial, public.v_refuerzos, public.v_bajas_activas,
              public.v_calendario, public.v_disponibilidad from anon, public;
grant select on public.v_historial, public.v_refuerzos, public.v_bajas_activas,
                public.v_calendario, public.v_disponibilidad to authenticated;

-- ── 5. Funciones (RPC) ────────────────────────────────────────
-- get_oferta_simple la usa Sustituciones y junta nombres de todos: se ejecuta
-- con permisos de dueño para que el voluntario vea los nombres del equipo.
alter function public.get_oferta_simple() security definer set search_path = public;
revoke execute on function public.get_oferta_simple()                       from public, anon;
revoke execute on function public.get_bajas_dashboard()                     from public, anon;
revoke execute on function public.get_resumen_carga()                       from public, anon;
revoke execute on function public.quien_puede_cubrir(integer, text, text, date) from public, anon;
grant  execute on function public.get_oferta_simple()                       to authenticated;
grant  execute on function public.get_bajas_dashboard()                     to authenticated;
grant  execute on function public.get_resumen_carga()                       to authenticated;
grant  execute on function public.quien_puede_cubrir(integer, text, text, date) to authenticated;

-- ── Comprobar ─────────────────────────────────────────────────
--   select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 2;

-- ── EMERGENCIA: volver a abrirlo todo (como antes) ────────────
-- Solo si algo deja de funcionar y hace falta tiempo para arreglarlo:
--
--   do $$ declare t text; begin
--     foreach t in array array['actividad','ajustes_estadisticas','apuntes_archivo','bajas','bajas_archivo',
--       'calendario','disponibilidad','disponibilidad_respaldo','historial','historial_archivo','navieras',
--       'refuerzos','turnos_no_realizados','turnos_resultado','voluntarios']
--     loop execute format('create policy emergencia_abierto on public.%I for all to anon, authenticated using (true) with check (true)', t); end loop;
--   end $$;
--   grant select on public.v_historial, public.v_refuerzos, public.v_bajas_activas, public.v_calendario, public.v_disponibilidad to anon;
--   grant execute on function public.get_oferta_simple(), public.get_bajas_dashboard(), public.get_resumen_carga() to anon;
--
-- (y para volver a cerrarlo: drop policy emergencia_abierto on cada tabla.)
