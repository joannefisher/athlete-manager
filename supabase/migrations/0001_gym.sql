-- ============================================================================
-- Gym module — initial schema
-- ============================================================================
-- This is the first Gym-related migration. Run it by hand in the Supabase
-- SQL editor (or via `supabase db push` if you use the CLI) against your
-- project.
--
-- Confirmed against the real app code (AthleteManager.tsx / RehabPlanner.tsx)
-- before writing this:
--   - user_profiles already has role, club_id, full_name, linked_athlete_id
--     (used to tie a 'Player' login to one row in athletes) — nothing to add
--     there, this migration only reads it.
--   - role already accepts 'Player' in production (RehabPlanner already
--     serves that role), so there's no CHECK constraint to touch.
--   - club_id columns are left WITHOUT a foreign key below, since no `clubs`
--     table is visible in this repo. Add `references clubs(id)` if you have
--     one.
--   - `gen_random_uuid()` needs the `pgcrypto` extension, on by default on
--     Supabase. If you hit "function does not exist", run
--     `create extension if not exists pgcrypto;` first.
--   - The RLS policies below are written from scratch (no other table's
--     policies are visible in this repo to copy) to match the club_id /
--     linked_athlete_id scoping the app code implies. Please skim them
--     against your real policies on athletes/rehab_plans/etc. and adjust if
--     your convention differs.
-- ============================================================================

-- ── Exercise group "types" (Anterior / Posterior today, editable list) ─────
create table if not exists gym_exercise_group_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

-- ── Exercise groups (e.g. "Squat", "Hinge", "Push", "Pull") ────────────────
create table if not exists gym_exercise_groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  type_id uuid references gym_exercise_group_types(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

-- ── Exercise bank ────────────────────────────────────────────────────────
create table if not exists gym_exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  exercise_group_id uuid not null references gym_exercise_groups(id) on delete restrict,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

create index if not exists idx_gym_exercises_group on gym_exercises(exercise_group_id);

-- ── Each player's default "Primary" exercise per exercise group ────────────
create table if not exists gym_player_default_primary (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  athlete_id uuid not null references athletes(id) on delete cascade,
  exercise_group_id uuid not null references gym_exercise_groups(id) on delete cascade,
  exercise_id uuid not null references gym_exercises(id) on delete restrict,
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (athlete_id, exercise_group_id)
);

-- ── Gym-only ad hoc player groups (independent of team_structure) ──────────
create table if not exists gym_session_groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  name text not null,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists gym_session_group_members (
  group_id uuid not null references gym_session_groups(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  primary key (group_id, athlete_id)
);

-- ── One gym session per athlete per date ────────────────────────────────
create table if not exists gym_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  -- Set only when this session was created as part of a group assignment;
  -- purely for traceability — editing one session never affects another.
  source_group_id uuid references gym_session_groups(id) on delete set null,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (athlete_id, date)
);

create index if not exists idx_gym_sessions_date on gym_sessions(club_id, date);
create index if not exists idx_gym_sessions_athlete on gym_sessions(athlete_id, date);

-- ── Ordered items within a session: exercises and/or free-text notes ───────
create table if not exists gym_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references gym_sessions(id) on delete cascade,
  sort_order int not null default 0,
  item_type text not null check (item_type in ('exercise', 'note')),

  -- exercise fields (null for item_type = 'note')
  exercise_id uuid references gym_exercises(id) on delete restrict,
  sets int,
  reps int,
  load text,
  is_primary boolean not null default false,
  -- The exercise actually shown/used after applying the default-swap rule.
  -- Equals exercise_id unless is_primary was true and the player had a
  -- different default for that exercise's group, in which case this points
  -- at the player's default and was_swapped is set — applied once, at save.
  effective_exercise_id uuid references gym_exercises(id) on delete restrict,
  was_swapped boolean not null default false,

  -- note fields (null for item_type = 'exercise')
  note_text text,

  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint gym_session_items_shape check (
    (item_type = 'exercise' and exercise_id is not null and note_text is null)
    or
    (item_type = 'note' and note_text is not null and exercise_id is null)
  )
);

create index if not exists idx_gym_session_items_session on gym_session_items(session_id, sort_order);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Every table is scoped to the caller's club via user_profiles.club_id;
-- gym_sessions/gym_session_items additionally restrict Players to their own
-- athlete via user_profiles.linked_athlete_id. Adjust to match your real
-- policy style if it differs.

alter table gym_exercise_group_types enable row level security;
alter table gym_exercise_groups enable row level security;
alter table gym_exercises enable row level security;
alter table gym_player_default_primary enable row level security;
alter table gym_session_groups enable row level security;
alter table gym_session_group_members enable row level security;
alter table gym_sessions enable row level security;
alter table gym_session_items enable row level security;

-- Everyone in a club can read exercise groups/types/bank; only Admin/Coach
-- write (mirrors gymCanEdit in components/gym/permissions.ts — keep in sync
-- if you change that helper).
create policy gym_exercise_group_types_select on gym_exercise_group_types
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid())
  );
create policy gym_exercise_group_types_write on gym_exercise_group_types
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_exercise_groups_select on gym_exercise_groups
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid())
  );
create policy gym_exercise_groups_write on gym_exercise_groups
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_exercises_select on gym_exercises
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid())
  );
create policy gym_exercises_write on gym_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

-- Players may only see/set their own default primary; staff can see any,
-- Admin/Coach can set any.
create policy gym_player_default_primary_select on gym_player_default_primary
  for select using (
    athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    or club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach','S&C','Physio'))
  );
create policy gym_player_default_primary_write on gym_player_default_primary
  for all using (
    athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    or club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    or club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_session_groups_all on gym_session_groups
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_session_group_members_all on gym_session_group_members
  for all using (
    group_id in (
      select id from gym_session_groups where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach')
      )
    )
  ) with check (
    group_id in (
      select id from gym_session_groups where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach')
      )
    )
  );

-- Staff (Admin/S&C/Physio/Coach) see every session in their club; a Player
-- only ever sees sessions for their own linked athlete. Writes limited to
-- Admin/Coach per gymCanEdit.
create policy gym_sessions_select on gym_sessions
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach'))
    or athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
  );
create policy gym_sessions_write on gym_sessions
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_session_items_select on gym_session_items
  for select using (
    session_id in (
      select id from gym_sessions where
        club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach'))
        or athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    )
  );
create policy gym_session_items_write on gym_session_items
  for all using (
    session_id in (
      select id from gym_sessions where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach')
      )
    )
  ) with check (
    session_id in (
      select id from gym_sessions where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach')
      )
    )
  );

-- ── Seed the two starting exercise-group types per existing club ───────────
-- Safe to re-run: the unique(club_id, name) constraint above prevents dupes.
insert into gym_exercise_group_types (club_id, name)
select distinct club_id, t.name
from user_profiles, (values ('Anterior'), ('Posterior')) as t(name)
where club_id is not null
on conflict (club_id, name) do nothing;
