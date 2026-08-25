-- ============================================================================
-- Gym module — left/right split session items
-- ============================================================================
-- Third Gym migration. Run this AFTER 0001_gym.sql and 0002_gym_exercise_review.sql
-- have already been applied. Run it by hand in the Supabase SQL editor, same
-- as the earlier two.
--
-- Adds a `side` column to gym_session_items: a coach adding an exercise can
-- leave it as one combined entry ('both', the default — no change to
-- existing rows or behavior), or split it into two independent items, one
-- 'left' and one 'right', each with its own sets/reps/load. The app creates
-- the two rows back-to-back (consecutive sort_order) rather than modeling a
-- pair in the schema — they're edited/deleted independently after creation.
-- ============================================================================

alter table gym_session_items
  add column if not exists side text not null default 'both' check (side in ('both', 'left', 'right'));
