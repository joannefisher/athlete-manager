-- ============================================================================
-- Gym module — exercise bank cleanup: review queue + merge
-- ============================================================================
-- Second Gym migration. Run this AFTER 0001_gym.sql has already been applied
-- (it adds columns to tables 0001 creates). Run it by hand in the Supabase
-- SQL editor, same as 0001.
--
-- What this adds:
--   - Every gym_exercises row gets a `status` ('pending' | 'approved'),
--     `archived`, and `merged_into_id`. New exercises are flagged 'pending'
--     for Admin review but stay immediately usable (not a hard gate) — a
--     coach adding an exercise mid-session shouldn't be blocked by it.
--   - A one-time backfill marks every EXISTING exercise 'approved', since
--     it's already been in active use — only new inserts going forward
--     default to 'pending'.
--   - gym_exercise_merges is a small audit table recording completed merges.
--   - merge_gym_exercises(...) is a `security definer` function that
--     rewrites every reference to the merged-away exercise (session items,
--     the swap-effective column, and player defaults) onto the surviving
--     exercise atomically, archives the merged row (kept for history, not
--     deleted), and logs the merge — called from the app via
--     `supabase.rpc('merge_gym_exercises', {...})`, the same pattern already
--     used for `invite_user_to_club` in AthleteManager.tsx.
-- ============================================================================

alter table gym_exercises
  add column if not exists status text not null default 'pending' check (status in ('pending', 'approved')),
  add column if not exists archived boolean not null default false,
  add column if not exists merged_into_id uuid references gym_exercises(id) on delete set null;

-- One-time backfill: exercises that already existed before this migration
-- have already been in real use — don't retroactively flag them as pending.
update gym_exercises set status = 'approved' where status = 'pending';

create index if not exists idx_gym_exercises_status on gym_exercises(club_id, status) where archived = false;
create index if not exists idx_gym_exercises_merged_into on gym_exercises(merged_into_id);

-- ── Merge audit trail ───────────────────────────────────────────────────
create table if not exists gym_exercise_merges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  merged_exercise_id uuid not null references gym_exercises(id) on delete cascade,
  merged_exercise_name text not null, -- snapshot at merge time, for history even if names change later
  survivor_exercise_id uuid not null references gym_exercises(id) on delete cascade,
  merged_by uuid references user_profiles(id) on delete set null,
  merged_at timestamptz not null default now()
);

alter table gym_exercise_merges enable row level security;

create policy gym_exercise_merges_select on gym_exercise_merges
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role = 'Admin')
  );
-- Inserts happen only via merge_gym_exercises() (security definer, bypasses RLS),
-- so no direct insert/update/delete policy is needed for normal app roles.

-- ── Merge function ───────────────────────────────────────────────────────
-- security definer so it can rewrite rows the calling user's own RLS
-- policies wouldn't otherwise let them touch in one pass; re-checks the
-- caller is an Admin itself rather than relying only on the app's UI gate.
create or replace function merge_gym_exercises(p_merged_id uuid, p_survivor_id uuid, p_merged_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_merged_group uuid;
  v_merged_club uuid;
  v_merged_name text;
  v_survivor_group uuid;
begin
  select role into v_role from user_profiles where id = p_merged_by;
  if v_role is distinct from 'Admin' then
    raise exception 'Only Admin users can merge exercises';
  end if;

  if p_merged_id = p_survivor_id then
    raise exception 'Cannot merge an exercise into itself';
  end if;

  select exercise_group_id, club_id, name into v_merged_group, v_merged_club, v_merged_name
    from gym_exercises where id = p_merged_id;
  select exercise_group_id into v_survivor_group from gym_exercises where id = p_survivor_id;

  if v_merged_group is null or v_survivor_group is null then
    raise exception 'Exercise not found';
  end if;
  if v_merged_group <> v_survivor_group then
    raise exception 'Can only merge exercises that belong to the same exercise group';
  end if;

  -- Rewrite history onto the survivor.
  update gym_session_items set exercise_id = p_survivor_id where exercise_id = p_merged_id;
  update gym_session_items set effective_exercise_id = p_survivor_id where effective_exercise_id = p_merged_id;
  update gym_player_default_primary
    set exercise_id = p_survivor_id, updated_by = p_merged_by, updated_at = now()
    where exercise_id = p_merged_id;

  -- Archive the merged-away exercise (kept for audit/history, hidden from pickers).
  update gym_exercises
    set archived = true, merged_into_id = p_survivor_id, status = 'approved'
    where id = p_merged_id;

  insert into gym_exercise_merges (club_id, merged_exercise_id, merged_exercise_name, survivor_exercise_id, merged_by)
    values (v_merged_club, p_merged_id, v_merged_name, p_survivor_id, p_merged_by);
end;
$$;

grant execute on function merge_gym_exercises(uuid, uuid, uuid) to authenticated;
