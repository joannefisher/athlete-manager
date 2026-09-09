-- 0017_last_modified_tracking.sql
-- Round 31 (2026-09-09): three "who/when last changed this" asks in one
-- migration, since all three are the same shape (add an audit column,
-- backfill nothing, start tracking from here on).
--
-- 1. gym_session_group_members — no audit columns existed at all (not even
--    created_at). Needed so the Gym groups "By player" screen can show who
--    last moved a given player into their current group, and when. Because
--    gymApi.setSessionGroupMembers works by deleting a membership row and
--    inserting a new one whenever a player's group changes (never an
--    in-place UPDATE), created_by/created_at on the CURRENT row already
--    means exactly "who moved them here, and when" — no separate
--    updated_by/updated_at needed on this table.
--
-- 2. gym_exercises — already had created_by/created_at (added by), but
--    nothing to say an exercise was edited afterwards (renamed / re-typed).
--    Nullable, no default: stays null until an actual edit happens via
--    gymApi.updateExerciseName/updateExerciseGroupType, so "was this ever
--    modified since creation" is just `updated_at is not null` — no
--    timestamp-diffing needed, unlike gym_sessions/gym_session_items below
--    (those already had NOT NULL DEFAULT NOW() updated_at columns from
--    migration 0001, so a freshly-created row already has a non-null
--    updated_at close to its created_at — the app code distinguishes
--    "genuinely edited" from "just created" there by diffing the two
--    timestamps instead, see SessionEditor.tsx).
--
-- gym_sessions and gym_session_items are NOT touched here — they already
-- have created_by/created_at/updated_by/updated_at from migration 0001.

alter table gym_session_group_members add column if not exists created_by uuid references user_profiles(id) on delete set null;
alter table gym_session_group_members add column if not exists created_at timestamptz not null default now();

alter table gym_exercises add column if not exists updated_by uuid references user_profiles(id) on delete set null;
alter table gym_exercises add column if not exists updated_at timestamptz;

-- Read-only sanity check, safe to run any time.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_session_group_members' and column_name = 'created_by'
  ) as group_members_audit_columns_added,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_exercises' and column_name = 'updated_at'
  ) as exercise_updated_at_added;
