-- ══════════════════════════════════════════════════════════════
--  11 · Tope de fines de semana por voluntario
--  ────────────────────────────────────────────────────────────
--  El formulario de disponibilidad por bloques pregunta, para sábado y
--  domingo por separado, "¿cuántos puedes al mes?" (1 a 5). Marcar el
--  bloque Mañana/Tarde en fin de semana solo dice qué horas puede ese día —
--  esto es aparte: cuántas veces al mes quiere que el motor lo coloque ahí.
--
--  null = sin tope (comportamiento de siempre, para quien no haya
--  contestado todavía la pregunta nueva).
--
--  Cómo ejecutarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Idempotente, se puede ejecutar varias veces sin romper nada.
-- ══════════════════════════════════════════════════════════════

alter table public.voluntarios
  add column if not exists max_sabados integer,
  add column if not exists max_domingos integer;
