-- 0014_fix_player_default_primary_onconflict.sql
-- Fixes "setting default exercises isn't updating" — reproduced and confirmed
-- against a real Postgres 16 instance before writing this (not a guess).
-- Two independent bugs stack here; both are fixed below.
--
-- BUG 1 — ROOT CAUSE: migration 0010 created gym_player_default_primary's unique key
-- as a PARTIAL index:
--   create unique index gym_player_default_primary_athlete_type_key
--     on gym_player_default_primary (athlete_id, exercise_group_type_id)
--     where exercise_group_type_id is not null;
-- gymApi.ts's setPlayerDefault() writes via:
--   .upsert(row, { onConflict: 'athlete_id,exercise_group_type_id' })
-- Supabase JS's onConflict shorthand always generates a predicate-less
-- ON CONFLICT (athlete_id, exercise_group_type_id) clause. Postgres will not
-- use a PARTIAL unique index as the arbiter for a predicate-less ON CONFLICT
-- clause (the WHERE clause has to be repeated verbatim in the INSERT
-- statement itself for Postgres to consider it a match, and the Supabase JS
-- client has no way to add one) — so every single setPlayerDefault() call
-- fails with error 42P10: "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification". GymSetup.tsx's cell-click handler
-- and PlayerGymView.tsx's equivalent both only console.error() on failure,
-- so this was silently swallowed — exactly matching the reported symptom of
-- clicking to set a default and nothing appearing to happen.
--
-- This is a SEPARATE bug from the user_profiles RLS recursion fixed in 0013
-- — that fix alone does not resolve this; run this migration too, in either
-- order relative to 0013.
--
-- FIX: swap the partial index for a plain unique constraint on the same two
-- columns. This is safe and behaviourally equivalent for this table's actual
-- use: standard SQL treats NULL as distinct from NULL for uniqueness
-- purposes, so multiple rows for the same athlete with a NULL
-- exercise_group_type_id already could never violate a *plain* unique
-- constraint either — the WHERE clause was never actually necessary to allow
-- that, and dropping it is what lets Supabase's plain ON CONFLICT
-- (athlete_id, exercise_group_type_id) actually match. Verified directly:
-- with the plain constraint in place, two NULL-exercise_group_type_id rows
-- for the same athlete both insert fine, and the same onConflict upsert
-- Supabase JS generates now succeeds and updates in place instead of erroring.
--
-- BUG 2 — found while re-checking this fix against the table's FULL real
-- schema (my first pass tested against a simplified stand-in table that
-- didn't include this column, which missed it): 0010 renamed the table's
-- original column to exercise_group_id_legacy (§4, "re-key from exercise
-- group to the new combination-type") but never dropped its NOT NULL
-- constraint from 0001_gym.sql — and it's still referenced by an
-- on-delete-restrict foreign key to gym_exercise_groups, so it can't just be
-- dropped outright without checking that table's still in use elsewhere.
-- setPlayerDefault() (gymApi.ts) never supplies exercise_group_id_legacy —
-- it only knows about exercise_group_type_id — so even after Bug 1 above is
-- fixed, every INSERT (i.e. every "set a default for this athlete/type
-- combo for the very first time") still fails outright with "null value in
-- column exercise_group_id_legacy violates not-null constraint". Reproduced
-- this against the full real schema (all 4 tables, both original and 0010's
-- alterations) before fixing it. The column itself is dead going forward
-- (0010's own comment confirms exercise_group_id_legacy is being kept only
-- for reference, unused) — the fix is simply to stop requiring it be filled.
--
-- SAFE TO RE-RUN: drops the index/constraint if present before recreating.

alter table gym_player_default_primary
  drop constraint if exists gym_player_default_primary_athlete_type_key;

drop index if exists gym_player_default_primary_athlete_type_key;

alter table gym_player_default_primary
  add constraint gym_player_default_primary_athlete_type_key
  unique (athlete_id, exercise_group_type_id);

alter table gym_player_default_primary
  alter column exercise_group_id_legacy drop not null;

-- ───────────────────────────────────────────────────────────────────────
-- Verify — run this after the above, replacing the two placeholder ids with
-- a real athlete_id and exercise_group_type_id from your own data (e.g. from
-- the gym_exercise_group_types / athletes tables). Run it twice in a row:
-- both times should succeed with no error, and the second run should update
-- the same row rather than creating a second one.
-- ───────────────────────────────────────────────────────────────────────
-- insert into gym_player_default_primary (athlete_id, exercise_group_type_id, exercise_id)
-- values ('PASTE_ATHLETE_ID', 'PASTE_EXERCISE_GROUP_TYPE_ID', 'PASTE_EXERCISE_ID')
-- on conflict (athlete_id, exercise_group_type_id)
-- do update set exercise_id = excluded.exercise_id;
