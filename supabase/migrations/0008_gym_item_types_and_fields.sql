-- ============================================================================
-- Gym module — Running/Conditioning/Timer item types + Load (kg)/Tempo fields
-- ============================================================================
-- Eighth Gym migration. Run this AFTER 0001 through 0007 have already been
-- applied, by hand in the Supabase SQL editor, same as every migration so far.
--
-- What this adds:
--   - Three new gym_session_items / gym_group_plan_items.item_type values,
--     alongside the existing 'exercise' and 'note':
--       'running'      — a distance-only item (no exercise-bank name), with
--                         distance_value + distance_unit ('m' or 'km').
--       'conditioning'  — same fields as 'exercise' (Sets/Reps/Load(kg)/
--                         Intensity/Tempo), same Exercise Bank picker, but
--                         is_primary is always false (no per-player default
--                         swap for this type — that stays exercise-only) and
--                         side is always 'both' (no left/right split).
--       'timer'         — a labelled duration (timer_label + duration_seconds),
--                         captured here as data only. The Player-facing
--                         countdown itself (start/pause while running a
--                         session) is a separate, later piece of work — as
--                         of this migration Player session views are still
--                         read-only, so nothing here executes a timer yet.
--   - Two new fields on 'exercise' AND 'conditioning' items: load_kg (numeric
--     — actual weight lifted, distinct from the existing `load` column, which
--     round 12 already renamed to "Intensity" for display and this round
--     changes to a %-only entry — see components/gym/gymApi.ts/types.ts
--     comments) and tempo (free text, entered as a single "X-X-X-X" string,
--     e.g. "3-1-1-0" — not validated/parsed at the DB level).
--
-- The existing item_type/_shape CHECK constraints on both tables are
-- replaced (Postgres's default name for an inline column-level CHECK is
-- `<table>_<column>_check` — confirmed against 0001/0005's `item_type text
-- not null check (...)` columns; if your actual constraint name differs,
-- `\d gym_session_items` / `\d gym_group_plan_items` in the SQL editor will
-- show the real name to drop instead).
-- ============================================================================

-- ── New columns (both tables) ───────────────────────────────────────────────

alter table gym_session_items
  add column if not exists load_kg numeric,
  add column if not exists tempo text,
  add column if not exists distance_value numeric,
  add column if not exists distance_unit text check (distance_unit in ('m', 'km')),
  add column if not exists timer_label text,
  add column if not exists duration_seconds int check (duration_seconds is null or duration_seconds > 0);

alter table gym_group_plan_items
  add column if not exists load_kg numeric,
  add column if not exists tempo text,
  add column if not exists distance_value numeric,
  add column if not exists distance_unit text check (distance_unit in ('m', 'km')),
  add column if not exists timer_label text,
  add column if not exists duration_seconds int check (duration_seconds is null or duration_seconds > 0);

-- ── Widen item_type to the 3 new values ────────────────────────────────────

alter table gym_session_items drop constraint if exists gym_session_items_item_type_check;
alter table gym_session_items add constraint gym_session_items_item_type_check
  check (item_type in ('exercise', 'note', 'running', 'conditioning', 'timer'));

alter table gym_group_plan_items drop constraint if exists gym_group_plan_items_item_type_check;
alter table gym_group_plan_items add constraint gym_group_plan_items_item_type_check
  check (item_type in ('exercise', 'note', 'running', 'conditioning', 'timer'));

-- ── Replace the "shape" check on both tables to cover the 3 new types ──────
-- 'conditioning' reuses the exercise-bank fields (exercise_id) but is pinned
-- to is_primary = false and side = 'both'. 'running'/'timer'/'note' are also
-- pinned to side = 'both' — none of them offer a left/right split.

alter table gym_session_items drop constraint if exists gym_session_items_shape;
alter table gym_session_items add constraint gym_session_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and note_text is null)
  or (item_type = 'note' and note_text is not null and exercise_id is null and side = 'both')
  or (item_type = 'conditioning' and exercise_id is not null and note_text is null and is_primary = false and side = 'both')
  or (item_type = 'running' and exercise_id is null and note_text is null and distance_value is not null and side = 'both')
  or (item_type = 'timer' and exercise_id is null and note_text is null and timer_label is not null and duration_seconds is not null and side = 'both')
);

alter table gym_group_plan_items drop constraint if exists gym_group_plan_items_shape;
alter table gym_group_plan_items add constraint gym_group_plan_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and note_text is null)
  or (item_type = 'note' and note_text is not null and exercise_id is null and side = 'both')
  or (item_type = 'conditioning' and exercise_id is not null and note_text is null and is_primary = false and side = 'both')
  or (item_type = 'running' and exercise_id is null and note_text is null and distance_value is not null and side = 'both')
  or (item_type = 'timer' and exercise_id is null and note_text is null and timer_label is not null and duration_seconds is not null and side = 'both')
);
