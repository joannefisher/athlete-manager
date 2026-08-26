-- ============================================================================
-- Gym module — separate Conditioning and Running exercise lists
-- ============================================================================
-- Ninth Gym migration. Run this AFTER 0001 through 0008 have already been
-- applied, by hand in the Supabase SQL editor, same as every migration so far.
--
-- What this adds:
--   - gym_conditioning_exercises: a simple flat list (name only), separate
--     from gym_exercises (the Gym-bank list used by 'exercise' items) — no
--     exercise-group/type hierarchy, since Conditioning no longer shares the
--     Gym exercise bank.
--   - gym_running_exercises: a flat list of name + distance_meters — each
--     entry names a specific effort (e.g. "400m sprint") and carries its own
--     distance. The distance is looked up live from this table (a join),
--     never snapshotted onto the session item — the same way an exercise
--     bank rename already propagates to every past session's display.
--   - conditioning_exercise_id / running_exercise_id: new nullable FK columns
--     on gym_session_items and gym_group_plan_items, alongside the existing
--     exercise_id column (which from this migration on is only ever set for
--     'exercise' items).
--   - The item_type/_shape CHECK constraints (from migration 0008) are
--     replaced again so 'conditioning' requires conditioning_exercise_id
--     (not exercise_id) and 'running' requires running_exercise_id (not
--     distance_value). load_kg/tempo staying null for 'conditioning' items
--     is enforced UI-only, not at the DB level (matches this migration's
--     Conditioning-DB-constraint answer) — the columns themselves are left
--     nullable and simply unused by this item type going forward.
--   - distance_value/distance_unit (added in 0008) are left in place but are
--     dead from this migration on — nothing here drops them, so no
--     historical data is destroyed, they're just never written to again.
-- ============================================================================

-- ── New tables ───────────────────────────────────────────────────────────

create table if not exists gym_conditioning_exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  archived boolean not null default false,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Partial unique index (not a plain unique constraint) so an archived name
-- can be reused — same pattern migration 0006 established for gym_exercises.
create unique index if not exists gym_conditioning_exercises_name_unique
  on gym_conditioning_exercises (club_id, name) where archived = false;

create table if not exists gym_running_exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  distance_meters numeric not null check (distance_meters > 0),
  archived boolean not null default false,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists gym_running_exercises_name_unique
  on gym_running_exercises (club_id, name) where archived = false;

-- ── New FK columns on both item tables ─────────────────────────────────────

alter table gym_session_items
  add column if not exists conditioning_exercise_id uuid references gym_conditioning_exercises(id) on delete restrict,
  add column if not exists running_exercise_id uuid references gym_running_exercises(id) on delete restrict;

alter table gym_group_plan_items
  add column if not exists conditioning_exercise_id uuid references gym_conditioning_exercises(id) on delete restrict,
  add column if not exists running_exercise_id uuid references gym_running_exercises(id) on delete restrict;

-- ── Replace the "shape" check on both tables ────────────────────────────────

alter table gym_session_items drop constraint if exists gym_session_items_shape;
alter table gym_session_items add constraint gym_session_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and note_text is null)
  or (item_type = 'note' and note_text is not null and exercise_id is null and side = 'both')
  or (item_type = 'conditioning' and conditioning_exercise_id is not null and exercise_id is null and note_text is null and is_primary = false and side = 'both')
  or (item_type = 'running' and running_exercise_id is not null and exercise_id is null and note_text is null and side = 'both')
  or (item_type = 'timer' and exercise_id is null and note_text is null and timer_label is not null and duration_seconds is not null and side = 'both')
);

alter table gym_group_plan_items drop constraint if exists gym_group_plan_items_shape;
alter table gym_group_plan_items add constraint gym_group_plan_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and note_text is null)
  or (item_type = 'note' and note_text is not null and exercise_id is null and side = 'both')
  or (item_type = 'conditioning' and conditioning_exercise_id is not null and exercise_id is null and note_text is null and is_primary = false and side = 'both')
  or (item_type = 'running' and running_exercise_id is not null and exercise_id is null and note_text is null and side = 'both')
  or (item_type = 'timer' and exercise_id is null and note_text is null and timer_label is not null and duration_seconds is not null and side = 'both')
);

-- ============================================================================
-- Row Level Security — same convention as gym_exercises (0001_gym.sql):
-- everyone in-club can read, only Admin/Coach can write.
-- ============================================================================

alter table gym_conditioning_exercises enable row level security;
alter table gym_running_exercises enable row level security;

create policy gym_conditioning_exercises_select on gym_conditioning_exercises
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid())
  );
create policy gym_conditioning_exercises_write on gym_conditioning_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_running_exercises_select on gym_running_exercises
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid())
  );
create policy gym_running_exercises_write on gym_running_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );
