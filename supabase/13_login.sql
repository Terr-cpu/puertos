-- ══════════════════════════════════════════════════════════════
--  13_login.sql — Login con correo y contraseña (Supabase Auth), FASE 1
--  ────────────────────────────────────────────────────────────
--  Prepara lo que necesitan index.html / auth.js para saber quién entra.
--  NO cambia todavía los permisos de las tablas (eso es 14_cerrar_bd.sql):
--  tras ejecutar esto, todo sigue funcionando exactamente igual.
--
--  · es_admin()          → true si el usuario tiene app_metadata.rol = 'admin'
--  · mi_voluntario_id()  → id de la ficha cuyo correo coincide con el del usuario
--  · mi_perfil()         → lo que pregunta auth.js al entrar
--  · Registro: solo pueden crear cuenta los correos que estén en alguna ficha
--    de voluntario activo (si no, Supabase rechaza el alta).
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Ver NOTIFICACIONES.md, "Ampliación J — Login".
-- ══════════════════════════════════════════════════════════════

-- ── ¿Es el admin? ─────────────────────────────────────────────
-- app_metadata solo se puede cambiar desde Supabase (no desde la app), así que
-- nadie puede hacerse admin a sí mismo.
create or replace function public.es_admin()
returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin', false)
$$;

-- ── Ficha del voluntario que ha entrado (por el correo) ───────
create or replace function public.mi_voluntario_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select v.id
  from public.voluntarios v
  where auth.uid() is not null
    and v.activo
    and v.email is not null
    and lower(trim(v.email)) = lower(auth.email())
  order by v.creado_en
  limit 1
$$;

create or replace function public.mi_perfil()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'es_admin', public.es_admin(),
    'voluntario', (select jsonb_build_object('id', v.id, 'nombre', v.nombre, 'tiene_llave', v.tiene_llave)
                   from public.voluntarios v where v.id = public.mi_voluntario_id())
  )
$$;

revoke execute on function public.es_admin()          from public, anon;
revoke execute on function public.mi_voluntario_id()  from public, anon;
revoke execute on function public.mi_perfil()         from public, anon;
grant  execute on function public.es_admin()          to authenticated;
grant  execute on function public.mi_voluntario_id()  to authenticated;
grant  execute on function public.mi_perfil()         to authenticated;

-- ── Registro solo para correos de fichas ──────────────────────
-- Si alguien intenta crear cuenta con un correo que no está en ninguna ficha de
-- voluntario activo, el alta falla (la página de login lo explica).
create or replace function public.solo_correos_de_voluntarios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.voluntarios v
    where v.activo and v.email is not null and lower(trim(v.email)) = lower(new.email)
  ) then
    raise exception 'CORREO_NO_REGISTRADO: % no está en ninguna ficha de voluntario', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists solo_correos_de_voluntarios on auth.users;
create trigger solo_correos_de_voluntarios
  before insert on auth.users
  for each row execute function public.solo_correos_de_voluntarios();

-- ── Hacer admin al coordinador ────────────────────────────────
-- Ejecutar DESPUÉS de haber creado tu cuenta desde la página de login
-- (y haber confirmado el correo). Luego cierra sesión y vuelve a entrar.
--
--   update auth.users
--   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"admin"}'::jsonb
--   where lower(email) = 'manuf.m@hotmail.com';
--
-- Comprobar:
--   select email, raw_app_meta_data ->> 'rol' as rol, email_confirmed_at from auth.users;
