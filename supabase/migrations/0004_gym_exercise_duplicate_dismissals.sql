-- ============================================================================
-- Gym module — exercise bank cleanup: "keep both" duplicate dismissals
-- ============================================================================
-- Fourth Gym migration. Run this AFTER 0001, 0002, and 0003 have already
-- been applied. Run it by hand in the Supabase SQL editor, same as those.
--
-- What this adds:
--   - gym_exercise_duplicate_dismissals records a pair of exercises an Admin
--     has looked at in the "Possible duplicates in the bank" list and
--     confirmed are genuinely different exercises, not a duplicate to merge.
--     ExerciseReviewPanel filters suggestMerges()'s output against this table
--     so a dismissed pair doesn't keep reappearing on every load — merging a
--     pair already removes it from the list (one side gets archived), this
--     covers the "keep both as unique entities" case where neither side goes
--     away.
--   - The pair is stored in a canonical (sorted-by-id) order so the same two
--     exercises always match one row regardless of which one suggestMerges()
--     happened to list first.
-- ============================================================================

create table if not exists gym_exercise_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  exercise_a_id uuid not null references gym_exercises(id) on delete cascade,
  exercise_b_id uuid not null references gym_exercises(id) on delete cascade,
  dismissed_by uuid references user_profiles(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  unique (exercise_a_id, exercise_b_id)
);

create index if not exists idx_gym_exercise_dup_dismissals_club on gym_exercise_duplicate_dismissals(club_id);

alter table gym_exercise_duplicate_dismissals enable row level security;

create policy gym_exercise_duplicate_dismissals_select on gym_exercise_duplicate_dismissals
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role = 'Admin')
  );

create policy gym_exercise_duplicate_dismissals_insert on gym_exercise_duplicate_dismissals
  for insert with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role = 'Admin')
  );
