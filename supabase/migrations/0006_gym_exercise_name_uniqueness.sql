-- ============================================================================
-- Gym module — allow a merged-away exercise name to be reused
-- ============================================================================
-- Sixth Gym migration. Run this AFTER 0001–0005 have already been applied.
--
-- Background: this fix was first described back in "round 6" as migration
-- 0005, but it never actually reached the real repo (confirmed via mtime
-- forensics in round 8) — round 9 then used the filename 0005 for the new
-- group-session-plan tables instead, since it was free. This is that same
-- fix, redelivered under its now-correct number, 0006.
--
-- The bug: gym_exercises has had a plain `unique (club_id, name)` constraint
-- since 0001. 0002 added `archived` (set true when an exercise is merged
-- away via merge_gym_exercises() — see round 2) but a merged-away row is
-- kept, not deleted, so its name stays permanently reserved. Creating a NEW
-- exercise that reuses a name that was ever merged/archived away then fails
-- with a Postgres unique-violation (23505).
--
-- The fix: drop the plain constraint and replace it with a partial unique
-- index that only applies to non-archived rows, so a freed-up name can be
-- reused once its old row is archived.
-- ============================================================================

-- The constraint from 0001's `unique (club_id, name)` table-level shorthand
-- was auto-named by Postgres in the standard `<table>_<cols>_key` form.
alter table gym_exercises drop constraint if exists gym_exercises_club_id_name_key;

create unique index if not exists gym_exercises_club_id_name_active_key
  on gym_exercises (club_id, name)
  where archived = false;
