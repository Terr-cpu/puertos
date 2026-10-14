-- ══════════════════════════════════════════════════════════════
--  15_dispo_habilitada.sql — Disponibilidad bloqueada tras la primera vez
--  ────────────────────────────────────────────────────────────
--  La primera vez que entra, el voluntario marca su disponibilidad (por bloques).
--  Después queda BLOQUEADA: la ve en "Mi disponibilidad" pero no puede cambiarla,
--  salvo que el coordinador se lo permita desde su ficha del planificador
--  ("Permitir que cambie su disponibilidad"). Cuando el voluntario la vuelve a
--  enviar, se bloquea otra vez sola.
--
--  voluntarios.dispo_habilitada = true → puede cambiarla ahora.
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar → Run.
--  (Los permisos que lo hacen cumplir en la base de datos van en 14_cerrar_bd.sql.)
-- ══════════════════════════════════════════════════════════════

alter table public.voluntarios add column if not exists dispo_habilitada boolean not null default false;
