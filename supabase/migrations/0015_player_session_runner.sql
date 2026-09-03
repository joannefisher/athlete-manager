-- 0015_player_session_runner.sql
-- New Player-facing Gym feature: a mobile session runner (Start/Pause/Resume/
-- Complete a session, walk exercise-by-exercise, record actual results per
-- set for reporting). See the "Player Gym UI" plan for full context.
--
-- Also fixes an unrelated but urgent, already-live bug found while building
-- this: every Gym write RLS policy still said `role in ('Admin','Coach')`,
-- never updated when gymCanEdit (components/gym/permissions.ts) changed
-- earlier today to `Admin/S&C/Physio`. Right now, in production, S&C and
-- Physio see edit controls in the UI (per the app-level check) but every
-- actual write — sessions, session items, group plans, exercise group
-- types, conditioning/running exercises, player defaults — is silently
-- rejected by the database. Section 3 below fixes every one of these.

-- ============================================================================
-- 1. Schema: gym_sessions gains status/pause-position columns
-- ============================================================================

alter table gym_sessions
  add column if not exists status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'paused', 'completed')),
  add column if not exists current_item_id uuid references gym_session_items(id) on delete set null,
  add column if not exists current_set_number int,
  add column if not exists started_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists completed_at timestamptz;

-- ============================================================================
-- 2. New table: one row per (session_item_id, set_number) of actual results
--    a player records while running a session. club_id/session_id are
--    denormalized from gym_session_items/gym_sessions directly — this is a
--    hot-write table during a live session (every set-save round-trips) and
--    both columns are needed by RLS on every write anyway, so avoiding a
--    second/third join level here matters more than on a cold table.
-- ============================================================================

create table if not exists gym_session_item_results (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  session_id uuid not null references gym_sessions(id) on delete cascade,
  session_item_id uuid not null references gym_session_items(id) on delete cascade,
  -- 1-based. exercise/conditioning: one row per prescribed set. running: no
  -- real "set" concept in the data model — always 1, a single actual-distance
  -- entry per item. timer/note/section never get a row here at all.
  set_number int not null check (set_number > 0),

  -- exercise: reps + load(kg) actually done.
  actual_reps int,
  actual_load_kg numeric,
  -- conditioning: reps (shares actual_reps above) + a new Time field —
  -- didn't exist as a prescribed field before this either; it's recorded
  -- purely as an actual, per Joanne's explicit call (Intensity(%) stays
  -- fixed/prescribed-only, not recorded here).
  actual_duration_seconds int,
  -- running: actual distance covered, replacing/confirming the prescribed
  -- fixed distance from gym_running_exercises.distance_meters.
  actual_distance_meters numeric,

  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  unique (session_item_id, set_number)
);

create index if not exists idx_gym_session_item_results_session on gym_session_item_results(session_id);

alter table gym_session_item_results enable row level security;

-- Players see/write only their own results, and only while the parent
-- session isn't completed. Staff (Admin/S&C/Physio) can read every result in
-- their club — this table exists for reporting, so staff read access is the
-- point, not an afterthought.
drop policy if exists gym_session_item_results_select on gym_session_item_results;
create policy gym_session_item_results_select on gym_session_item_results
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
    or session_id in (
      select id from gym_sessions where athlete_id in (
        select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null
      )
    )
  );

drop policy if exists gym_session_item_results_write on gym_session_item_results;
create policy gym_session_item_results_write on gym_session_item_results
  for all using (
    session_id in (
      select id from gym_sessions
      where athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
        and status <> 'completed'
    )
  ) with check (
    session_id in (
      select id from gym_sessions
      where athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
        and status <> 'completed'
    )
  );

-- ============================================================================
-- 3. Player session lifecycle — security definer RPCs, not a raw table
--    policy. gym_sessions.date/athlete_id/club_id must never be
--    Player-writable, and Postgres RLS can't restrict by column — so instead
--    of a policy, these four functions run as their owner (bypassing RLS
--    internally, same precedent as current_user_profile_flags() in
--    0013_fix_user_profiles_rls_recursion.sql) and each explicitly checks
--    the caller's own linked_athlete_id against the session's athlete_id
--    before touching only the status/position/timestamp columns it owns.
-- ============================================================================

create or replace function public.player_start_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_athlete_id uuid;
  v_caller_athlete_id uuid;
begin
  select linked_athlete_id into v_caller_athlete_id from user_profiles where id = auth.uid();
  if v_caller_athlete_id is null then
    raise exception 'no linked athlete for this user';
  end if;

  select athlete_id into v_session_athlete_id from gym_sessions where id = p_session_id;
  if v_session_athlete_id is null then
    raise exception 'session not found';
  end if;
  if v_session_athlete_id <> v_caller_athlete_id then
    raise exception 'not your session';
  end if;

  update gym_sessions
  set status = 'in_progress',
      started_at = coalesce(started_at, now()),
      current_item_id = null,
      current_set_number = null,
      paused_at = null
  where id = p_session_id and status = 'planned';
end;
$$;

create or replace function public.player_pause_session(p_session_id uuid, p_item_id uuid, p_set_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_athlete_id uuid;
  v_caller_athlete_id uuid;
begin
  select linked_athlete_id into v_caller_athlete_id from user_profiles where id = auth.uid();
  if v_caller_athlete_id is null then
    raise exception 'no linked athlete for this user';
  end if;

  select athlete_id into v_session_athlete_id from gym_sessions where id = p_session_id;
  if v_session_athlete_id is null or v_session_athlete_id <> v_caller_athlete_id then
    raise exception 'not your session';
  end if;

  -- p_item_id must genuinely belong to this session — refuse a position
  -- pointer that doesn't, rather than silently storing a dangling/foreign id.
  if p_item_id is not null and not exists (
    select 1 from gym_session_items where id = p_item_id and session_id = p_session_id
  ) then
    raise exception 'item does not belong to this session';
  end if;

  update gym_sessions
  set status = 'paused',
      paused_at = now(),
      current_item_id = p_item_id,
      current_set_number = p_set_number
  where id = p_session_id and status = 'in_progress';
end;
$$;

create or replace function public.player_resume_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_athlete_id uuid;
  v_caller_athlete_id uuid;
begin
  select linked_athlete_id into v_caller_athlete_id from user_profiles where id = auth.uid();
  if v_caller_athlete_id is null then
    raise exception 'no linked athlete for this user';
  end if;

  select athlete_id into v_session_athlete_id from gym_sessions where id = p_session_id;
  if v_session_athlete_id is null or v_session_athlete_id <> v_caller_athlete_id then
    raise exception 'not your session';
  end if;

  -- Leaves current_item_id/current_set_number exactly as they were set by
  -- the pause that preceded this — the caller reads them back afterwards to
  -- know which step to resume on. If the referenced item was since deleted
  -- (a staff edit while paused), current_item_id will already be null via
  -- the FK's own "on delete set null" — the runner treats that as "session
  -- changed since you paused" and restarts from step 1, not a recovery case
  -- handled here.
  update gym_sessions
  set status = 'in_progress',
      paused_at = null
  where id = p_session_id and status = 'paused';
end;
$$;

create or replace function public.player_complete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_athlete_id uuid;
  v_caller_athlete_id uuid;
begin
  select linked_athlete_id into v_caller_athlete_id from user_profiles where id = auth.uid();
  if v_caller_athlete_id is null then
    raise exception 'no linked athlete for this user';
  end if;

  select athlete_id into v_session_athlete_id from gym_sessions where id = p_session_id;
  if v_session_athlete_id is null or v_session_athlete_id <> v_caller_athlete_id then
    raise exception 'not your session';
  end if;

  -- Idempotent: a double-submit on the last step's Next tap just no-ops the
  -- second call rather than erroring, since status <> 'in_progress' by then.
  update gym_sessions
  set status = 'completed',
      completed_at = now(),
      current_item_id = null,
      current_set_number = null
  where id = p_session_id and status = 'in_progress';
end;
$$;

grant execute on function public.player_start_session(uuid) to authenticated;
grant execute on function public.player_pause_session(uuid, uuid, int) to authenticated;
grant execute on function public.player_resume_session(uuid) to authenticated;
grant execute on function public.player_complete_session(uuid) to authenticated;

-- ============================================================================
-- 4. Fix the stale role list — every Gym write policy that still says
--    `role in ('Admin','Coach')` becomes `role in ('Admin','S&C','Physio')`,
--    matching gymCanEdit. Uses drop-if-exists + recreate throughout, same
--    pattern as 0013, so this is safe to re-run.
-- ============================================================================

drop policy if exists gym_exercise_group_types_write on gym_exercise_group_types;
create policy gym_exercise_group_types_write on gym_exercise_group_types
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

-- NOTE: gym_exercise_groups was renamed to gym_exercise_groups_legacy by
-- 0010_gym_exercise_group_type_hierarchy_and_sections.sql (superseded by
-- gym_exercise_group_types' new hierarchy) and is no longer written by any
-- live app code, so it's deliberately NOT included here — there's nothing
-- to fix on a dead table, and a policy pointed at a table name that no
-- longer exists would just fail this migration outright.

drop policy if exists gym_exercises_write on gym_exercises;
create policy gym_exercises_write on gym_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_player_default_primary_write on gym_player_default_primary;
create policy gym_player_default_primary_write on gym_player_default_primary
  for all using (
    athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    or club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    athlete_id in (select linked_athlete_id from user_profiles where id = auth.uid() and linked_athlete_id is not null)
    or club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_session_groups_all on gym_session_groups;
create policy gym_session_groups_all on gym_session_groups
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio', 'Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_session_group_members_all on gym_session_group_members;
create policy gym_session_group_members_all on gym_session_group_members
  for all using (
    group_id in (
      select id from gym_session_groups where
        club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio', 'Coach'))
    )
  ) with check (
    group_id in (
      select id from gym_session_groups where
        club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
    )
  );

drop policy if exists gym_sessions_write on gym_sessions;
create policy gym_sessions_write on gym_sessions
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_session_items_write on gym_session_items;
create policy gym_session_items_write on gym_session_items
  for all using (
    session_id in (
      select id from gym_sessions where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio')
      )
    )
  ) with check (
    session_id in (
      select id from gym_sessions where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio')
      )
    )
  );

drop policy if exists gym_group_session_plans_write on gym_group_session_plans;
create policy gym_group_session_plans_write on gym_group_session_plans
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_group_plan_items_write on gym_group_plan_items;
create policy gym_group_plan_items_write on gym_group_plan_items
  for all using (
    plan_id in (
      select id from gym_group_session_plans where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio')
      )
    )
  ) with check (
    plan_id in (
      select id from gym_group_session_plans where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio')
      )
    )
  );

drop policy if exists gym_conditioning_exercises_write on gym_conditioning_exercises;
create policy gym_conditioning_exercises_write on gym_conditioning_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

drop policy if exists gym_running_exercises_write on gym_running_exercises;
create policy gym_running_exercises_write on gym_running_exercises
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'S&C', 'Physio'))
  );

-- ───────────────────────────────────────────────────────────────────────
-- Verify — run after the above.
-- 1. Every policy below should show 'S&C' and 'Physio' in its qual/with_check,
--    and NONE should show 'Coach' anymore in a *_write policy (Coach keeps
--    read access on the _select policies above it was already in, e.g.
--    gym_sessions_select — this migration only touches *write* policies).
-- ───────────────────────────────────────────────────────────────────────
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename like 'gym_%'
  and policyname like '%write%' or policyname like '%_all'
order by tablename, policyname;
