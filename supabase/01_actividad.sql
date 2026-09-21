-- ══════════════════════════════════════════════════════════════
--  01 · Registro de actividad (auditoría)
--  ────────────────────────────────────────────────────────────
--  Guarda, con hora, TODO lo que pasa en historial / bajas / refuerzos:
--  bajas, bajas anuladas, apuntes, APUNTES CANCELADOS, personas añadidas
--  o quitadas de un turno. Lo escribe la propia base de datos (triggers),
--  así que queda registrado lo haga quien lo haga (planificador,
--  sustituciones, SQL a mano) y aunque la app esté cerrada.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar varias veces sin romper nada (es idempotente).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.actividad (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  tipo            text not null,   -- baja | baja_anulada | apunte | apunte_cancelado | equipo_anadido | equipo_quitado
  tabla           text not null,
  operacion       text not null,   -- INSERT | UPDATE | DELETE
  voluntario_id   text,
  nombre          text,            -- foto del nombre en ese momento
  fecha           text,            -- fecha del turno (yyyy-mm-dd)
  rango           text,
  es_dia_completo boolean not null default false
);

create index if not exists actividad_ts_idx on public.actividad (ts desc);

-- La app lee con la clave pública: solo lectura. Escribir solo pueden los triggers.
alter table public.actividad enable row level security;
drop policy if exists actividad_lectura on public.actividad;
create policy actividad_lectura on public.actividad
  for select to anon, authenticated using (true);
grant select on public.actividad to anon, authenticated;

-- ── Función común de los triggers ─────────────────────────────
create or replace function public.registrar_actividad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  o        jsonb;
  v_tipo   text;
  v_nombre text;
begin
  if TG_OP = 'DELETE' then
    r := to_jsonb(OLD);
  else
    r := to_jsonb(NEW);
  end if;
  if TG_OP = 'UPDATE' then
    o := to_jsonb(OLD);
  end if;

  if TG_TABLE_NAME = 'bajas' then
    if TG_OP = 'INSERT' then
      if coalesce((r->>'activa')::boolean, true) then v_tipo := 'baja'; end if;
    elsif TG_OP = 'UPDATE' then
      if coalesce((o->>'activa')::boolean, false) and not coalesce((r->>'activa')::boolean, false) then
        v_tipo := 'baja_anulada';
      elsif not coalesce((o->>'activa')::boolean, false) and coalesce((r->>'activa')::boolean, false) then
        v_tipo := 'baja';          -- baja que se vuelve a registrar sobre una anulada
      end if;
    else                            -- DELETE
      if coalesce((r->>'activa')::boolean, true) then v_tipo := 'baja_anulada'; end if;
    end if;

  elsif TG_TABLE_NAME = 'refuerzos' then
    if TG_OP = 'INSERT' then v_tipo := 'apunte';
    elsif TG_OP = 'DELETE' then v_tipo := 'apunte_cancelado';
    end if;

  elsif TG_TABLE_NAME = 'historial' then
    if TG_OP = 'INSERT' then
      v_tipo := 'equipo_anadido';
    elsif TG_OP = 'DELETE' then
      -- Al archivar un mes se borran filas pasadas: eso no es un cambio de equipo
      if (r->>'fecha') >= to_char(current_date, 'YYYY-MM-DD') then v_tipo := 'equipo_quitado'; end if;
    end if;
  end if;

  if v_tipo is not null then
    select v.nombre into v_nombre from public.voluntarios v where v.id::text = r->>'voluntario_id';
    insert into public.actividad (tipo, tabla, operacion, voluntario_id, nombre, fecha, rango, es_dia_completo)
    values (v_tipo, TG_TABLE_NAME, TG_OP, r->>'voluntario_id', v_nombre, r->>'fecha',
            nullif(r->>'rango', ''), coalesce((r->>'es_dia_completo')::boolean, false));
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists trg_actividad on public.bajas;
create trigger trg_actividad after insert or update or delete on public.bajas
  for each row execute function public.registrar_actividad();

drop trigger if exists trg_actividad on public.refuerzos;
create trigger trg_actividad after insert or delete on public.refuerzos
  for each row execute function public.registrar_actividad();

drop trigger if exists trg_actividad on public.historial;
create trigger trg_actividad after insert or delete on public.historial
  for each row execute function public.registrar_actividad();

-- ── Baja que se vuelve a registrar: que cuente como NUEVA ─────
-- registrarBaja hace un upsert; si ya existía esa baja (anulada), en vez de un
-- INSERT se produce un UPDATE y la fecha "registrado_en" seguía siendo la
-- antigua, así que no aparecía como novedad en la app.
create or replace function public.bajas_reactivada_ts()
returns trigger
language plpgsql
as $$
begin
  if not coalesce(OLD.activa, false) and coalesce(NEW.activa, false) then
    NEW.registrado_en := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_bajas_reactivada_ts on public.bajas;
create trigger trg_bajas_reactivada_ts before update on public.bajas
  for each row execute function public.bajas_reactivada_ts();

-- ── Comprobación rápida ───────────────────────────────────────
-- Después de ejecutar, esta consulta debe devolver 0 filas (aún no hay
-- actividad) y no dar error:
--   select * from public.actividad order by ts desc limit 20;
