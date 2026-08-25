-- ============================================================================
-- Gym module — group session plans (UI 2 "All" mode + group-plan syncing)
-- ============================================================================
-- Fifth Gym migration. Run this AFTER 0001, 0002, 0003, and 0004 have already
-- been applied. Run it by hand in the Supabase SQL editor, same as those.
--
-- NOTE: an earlier round's write-up described a DIFFERENT "0005" migration
-- (gym_exercise_name_uniqueness — reusing an exercise name that was ever
-- merged/archived away). Mtime forensics on the real repo showed that fix was
-- never actually committed, so this filename was free to reuse. If that
-- exercise-name fix is redelivered later, it should land as 0006, after this
-- one.
--
-- What this adds:
--   - gym_group_session_plans / gym_group_plan_items: a canonical, per-
--     group-per-date exercise list — the "group session plan" — kept
--     separate from each member's own gym_sessions/gym_session_items rows.
--     Editing this (via UI 2's new "All" mode, one shared session for a
--     whole group) is what fans changes out to every member's own session.
--   - gym_session_items.plan_item_id: links a member's own item back to the
--     group plan item it was created/synced from, so a later plan edit can
--     tell whether that member's item still matches the plan (safe to
--     auto-update, no confirmation needed) or has drifted from it (needs a
--     manual accept-new/keep-current decision) — see gymApi.ts's
--     syncGroupPlanItemChange()/resolveGroupPlanConflict() and
--     GroupPlanEditor.tsx for the full rules and the confirmation UI.
--     Deliberately nullable and NOT unique — an individual's own additions
--     (never linked to any plan item) are left alone by every plan sync.
--
-- Not enforced at the database level: "a player can only be in one gym group
-- at a time" is enforced in the app (GroupPicker.tsx shows a confirmation
-- naming the player's current group before reassigning them) rather than a
-- DB constraint, since a hard unique(athlete_id) on gym_session_group_members
-- would fail to apply if any existing data already has a player in two
-- groups from before this rule existed.
-- ============================================================================

create table if not exists gym_group_session_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  group_id uuid not null references gym_session_groups(id) on delete cascade,
  date date not null,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (group_id, date)
);

create index if not exists idx_gym_group_session_plans_date on gym_group_session_plans(club_id, date);

create table if not exists gym_group_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references gym_group_session_plans(id) on delete cascade,
  sort_order int not null default 0,
  item_type text not null check (item_type in ('exercise', 'note')),

  exercise_id uuid references gym_exercises(id) on delete restrict,
  sets int,
  reps int,
  load text,
  is_primary boolean not null default false,
  side text not null default 'both' check (side in ('both', 'left', 'right')),

  note_text text,

  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint gym_group_plan_items_shape check (
    (item_type = 'exercise' and exercise_id is not null and note_text is null)
    or
    (item_type = 'note' and note_text is not null and exercise_id is null)
  )
);

create index if not exists idx_gym_group_plan_items_plan on gym_group_plan_items(plan_id, sort_order);

alter table gym_session_items
  add column if not exists plan_item_id uuid references gym_group_plan_items(id) on delete set null;

create index if not exists idx_gym_session_items_plan_item on gym_session_items(plan_item_id);

-- ============================================================================
-- Row Level Security — same club_id / Admin-Coach-write convention as 0001.
-- ============================================================================

alter table gym_group_session_plans enable row level security;
alter table gym_group_plan_items enable row level security;

create policy gym_group_session_plans_select on gym_group_session_plans
  for select using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach'))
  );
create policy gym_group_session_plans_write on gym_group_session_plans
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach'))
  );

create policy gym_group_plan_items_select on gym_group_plan_items
  for select using (
    plan_id in (
      select id from gym_group_session_plans where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','S&C','Physio','Coach')
      )
    )
  );
create policy gym_group_plan_items_write on gym_group_plan_items
  for all using (
    plan_id in (
      select id from gym_group_session_plans where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach')
      )
    )
  ) with check (
    plan_id in (
      select id from gym_group_session_plans where club_id in (
        select club_id from user_profiles where id = auth.uid() and role in ('Admin','Coach')
      )
    )
  );
