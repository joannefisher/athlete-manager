-- Round 17: replace the old two-level "Exercise Group Type" (simple tag,
-- e.g. "Anterior") -> "Exercise Group" (named, e.g. "Squat") -> Exercise
-- hierarchy with a single hierarchical "Exercise Group Type" defined by a
-- fixed set of attributes:
--   body_region:     'upper' | 'lower'                       (required)
--   upper_push_pull: 'push' | 'pull'                         (upper only)
--   upper_plane:     'vertical' | 'horizontal'                (upper only)
--   lower_position:  'anterior' | 'posterior' | 'other'       (lower only)
--   laterality:      'unilateral' | 'bilateral'               (always, independent of the above)
-- Per Joanne's answers: "Other" is a plain third option alongside
-- Anterior/Posterior (not a special case), and Unilateral/Bilateral is a
-- fully independent toggle applied no matter what else was picked. The
-- unique combination of these attributes IS the "type" — e.g. (Lower Body,
-- Anterior, Bilateral) is one type, reused by every exercise that matches it
-- (this is also how the player Primary-default mechanism is now keyed, see
-- gym_player_default_primary below).
--
-- Safety approach for live production data: nothing is dropped. The old
-- gym_exercise_group_types/gym_exercise_groups tables are renamed (kept,
-- read-only, for audit/rollback) rather than deleted, and gym_exercises'
-- new exercise_group_type_id is populated by a best-effort keyword match
-- against the old gym_exercise_groups' names — anything not confidently
-- matched is left null and surfaces in the Exercises admin screen's new
-- "Needs review" list for Joanne to assign by hand (per her "best-effort
-- auto-map, then review" answer). A later cleanup migration can drop the
-- _legacy tables/columns once she's confirmed the review pass is done.

-- ── 1. Preserve the old tables under new names ──────────────────────────
alter table gym_exercise_group_types rename to gym_exercise_group_types_legacy;
alter table gym_exercise_groups rename to gym_exercise_groups_legacy;

-- ── 2. New hierarchical Exercise Group Type table ───────────────────────
create table gym_exercise_group_types (
  id uuid primary key default gen_random_uuid(),
  -- No FK to a `clubs` table — matches every other club_id column in this
  -- module (see 0001_gym.sql's own note: no clubs table is visible in this repo).
  club_id uuid not null,
  body_region text not null check (body_region in ('upper', 'lower')),
  upper_push_pull text check (upper_push_pull in ('push', 'pull')),
  upper_plane text check (upper_plane in ('vertical', 'horizontal')),
  lower_position text check (lower_position in ('anterior', 'posterior', 'other')),
  laterality text not null check (laterality in ('unilateral', 'bilateral')),
  archived boolean not null default false,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  constraint gym_exercise_group_types_upper_fields check (
    (body_region = 'upper' and upper_push_pull is not null and upper_plane is not null and lower_position is null)
    or
    (body_region = 'lower' and lower_position is not null and upper_push_pull is null and upper_plane is null)
  )
);

-- One row per distinct attribute combination per club (active rows only) —
-- coalesce() so the nullable upper/lower-only columns don't let Postgres'
-- normal "NULL <> NULL" unique-index behaviour create duplicate combos.
create unique index gym_exercise_group_types_combo_key
  on gym_exercise_group_types (
    club_id,
    body_region,
    coalesce(upper_push_pull, ''),
    coalesce(upper_plane, ''),
    coalesce(lower_position, ''),
    laterality
  )
  where archived = false;

alter table gym_exercise_group_types enable row level security;

create policy gym_exercise_group_types_select on gym_exercise_group_types
  for select using (club_id in (select club_id from user_profiles where id = auth.uid()));

create policy gym_exercise_group_types_write on gym_exercise_group_types
  for all using (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'Coach'))
  ) with check (
    club_id in (select club_id from user_profiles where id = auth.uid() and role in ('Admin', 'Coach'))
  );

-- ── 3. gym_exercises: point at the new hierarchical type instead ───────
alter table gym_exercises add column exercise_group_type_id uuid references gym_exercise_group_types(id) on delete restrict;
alter table gym_exercises rename column exercise_group_id to exercise_group_id_legacy;

-- Best-effort auto-map: derive a type combo from each *legacy* exercise
-- group's name via simple keyword matching, insert the combo (if it doesn't
-- already exist for this club), then point every exercise that belonged to
-- that legacy group at the new combo. Anything the keywords don't confidently
-- cover (an unmatched legacy group name) is simply skipped here — those
-- exercises are left with exercise_group_type_id null and show up in the
-- Exercises admin screen's "Needs review" list for Joanne to assign herself.
do $$
declare
  g record;
  guessed_body_region text;
  guessed_push_pull text;
  guessed_plane text;
  guessed_lower_position text;
  guessed_laterality text;
  matched_type_id uuid;
begin
  for g in select id, club_id, name from gym_exercise_groups_legacy loop
    guessed_body_region := null;
    guessed_push_pull := null;
    guessed_plane := null;
    guessed_lower_position := null;
    guessed_laterality := 'bilateral'; -- safe default; a name-based unilateral hint overrides below

    if g.name ilike any (array['%squat%','%lunge%','%leg%','%hinge%','%deadlift%','%calf%','%hamstring%','%glute%','%quad%','%hip%']) then
      guessed_body_region := 'lower';
      if g.name ilike any (array['%quad%','%anterior%','%front%']) then
        guessed_lower_position := 'anterior';
      elsif g.name ilike any (array['%hamstring%','%glute%','%posterior%','%hinge%','%deadlift%']) then
        guessed_lower_position := 'posterior';
      else
        guessed_lower_position := 'other';
      end if;
    elsif g.name ilike any (array['%push%','%press%','%chest%','%shoulder%','%tricep%']) then
      guessed_body_region := 'upper';
      guessed_push_pull := 'push';
      guessed_plane := case when g.name ilike any (array['%overhead%','%incline%','%vertical%']) then 'vertical' else 'horizontal' end;
    elsif g.name ilike any (array['%pull%','%row%','%back%','%lat%','%bicep%']) then
      guessed_body_region := 'upper';
      guessed_push_pull := 'pull';
      guessed_plane := case when g.name ilike any (array['%pull up%','%pull-up%','%pullup%','%chin%','%vertical%']) then 'vertical' else 'horizontal' end;
    end if;

    if g.name ilike any (array['%single leg%','%single arm%','%single-leg%','%single-arm%','%unilateral%','%split%']) then
      guessed_laterality := 'unilateral';
    end if;

    -- Skip anything the keywords above didn't confidently place — left for manual review.
    if guessed_body_region is null then
      continue;
    end if;

    select id into matched_type_id
    from gym_exercise_group_types
    where club_id = g.club_id
      and body_region = guessed_body_region
      and coalesce(upper_push_pull, '') = coalesce(guessed_push_pull, '')
      and coalesce(upper_plane, '') = coalesce(guessed_plane, '')
      and coalesce(lower_position, '') = coalesce(guessed_lower_position, '')
      and laterality = guessed_laterality
      and archived = false;

    if matched_type_id is null then
      insert into gym_exercise_group_types (club_id, body_region, upper_push_pull, upper_plane, lower_position, laterality)
      values (g.club_id, guessed_body_region, guessed_push_pull, guessed_plane, guessed_lower_position, guessed_laterality)
      returning id into matched_type_id;
    end if;

    update gym_exercises set exercise_group_type_id = matched_type_id where exercise_group_id_legacy = g.id;
  end loop;
end $$;

-- ── 4. gym_player_default_primary: re-key from exercise group to the new combination-type ──
alter table gym_player_default_primary add column exercise_group_type_id uuid references gym_exercise_group_types(id) on delete restrict;
alter table gym_player_default_primary rename column exercise_group_id to exercise_group_id_legacy;

update gym_player_default_primary d
set exercise_group_type_id = e.exercise_group_type_id
from gym_exercises e
where e.id = d.exercise_id and e.exercise_group_type_id is not null;

-- New target for the upsert setPlayerDefault() uses (athlete_id, exercise_group_type_id)
-- — old (athlete_id, exercise_group_id_legacy) unique constraint is left in place, just unused.
create unique index gym_player_default_primary_athlete_type_key
  on gym_player_default_primary (athlete_id, exercise_group_type_id)
  where exercise_group_type_id is not null;

-- ── 5. Named "sections" — a simple divider within a session/plan's item list ──
-- Modelled the same way Running/Conditioning/Timer were added (round 15): a
-- new item_type value plus one new nullable field, reusing the existing
-- ordered item list rather than a separate table. A section has no
-- interaction with Supersets or Split left/right (per Joanne's answer) —
-- app code simply never offers those for a 'section' item.

alter table gym_session_items add column section_name text;
alter table gym_group_plan_items add column section_name text;

alter table gym_session_items drop constraint if exists gym_session_items_shape;
alter table gym_session_items add constraint gym_session_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null)
  or (item_type = 'conditioning' and conditioning_exercise_id is not null and exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'running' and running_exercise_id is not null and exercise_id is null and conditioning_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'timer' and timer_label is not null and duration_seconds is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'note' and note_text is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'section' and section_name is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and note_text is null and is_primary = false and side = 'both')
);
alter table gym_session_items drop constraint if exists gym_session_items_item_type_check;
alter table gym_session_items add constraint gym_session_items_item_type_check
  check (item_type in ('exercise', 'note', 'running', 'conditioning', 'timer', 'section'));

alter table gym_group_plan_items drop constraint if exists gym_group_plan_items_shape;
alter table gym_group_plan_items add constraint gym_group_plan_items_shape check (
  (item_type = 'exercise' and exercise_id is not null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null)
  or (item_type = 'conditioning' and conditioning_exercise_id is not null and exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'running' and running_exercise_id is not null and exercise_id is null and conditioning_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'timer' and timer_label is not null and duration_seconds is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'note' and note_text is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and section_name is null and is_primary = false and side = 'both')
  or (item_type = 'section' and section_name is not null and exercise_id is null and conditioning_exercise_id is null and running_exercise_id is null and note_text is null and is_primary = false and side = 'both')
);
alter table gym_group_plan_items drop constraint if exists gym_group_plan_items_item_type_check;
alter table gym_group_plan_items add constraint gym_group_plan_items_item_type_check
  check (item_type in ('exercise', 'note', 'running', 'conditioning', 'timer', 'section'));

-- Note: this migration deliberately does NOT drop gym_exercise_group_types_legacy,
-- gym_exercise_groups_legacy, gym_exercises.exercise_group_id_legacy, or
-- gym_player_default_primary.exercise_group_id_legacy — they're kept, unused,
-- as a safety net. Once the "Needs review" list in the Exercises admin screen
-- is empty (every exercise has a real exercise_group_type_id) a follow-up
-- cleanup migration can drop them for good.
