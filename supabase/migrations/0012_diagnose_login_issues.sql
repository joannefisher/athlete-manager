-- 0012_diagnose_login_issues.sql
-- NOT a migration — do not add this to the migrations runner. Run it by hand
-- in the Supabase SQL editor, section by section.
--
-- WHY THIS EXISTS: Joanne reported "No club profile found. Contact your
-- administrator." for a specific user (Aiden Oakley) despite confirming his
-- user_profiles row has the correct club_id. The app's own read of that row
-- (AthleteManager.tsx's loadProfile()) is gated by RLS — it does
-- .from('user_profiles').select(...).eq('id', userId).maybeSingle(). Round
-- 19's migration (0011) added a policy that should let ANY authenticated
-- user read their own row unconditionally:
--   create policy ringfence_user_profiles_self_select on public.user_profiles
--     for select using (id = auth.uid());
-- If that policy is actually in effect, this symptom shouldn't be possible
-- from the app code alone — so before assuming a new code bug, this script
-- checks the two things that would actually explain it: (1) whether 0011
-- (and the earlier Gym migrations 0007-0010) have actually been run against
-- this database yet — a recurring issue in this project's history — and (2)
-- whether Aiden's specific row has an id that doesn't match his real
-- auth.users id, or is duplicated.
--
-- This would also explain the separately-reported
-- "column gym_exercise_group_types.body_region does not exist" error
-- (from migration 0010) — same likely root cause (pending migrations),
-- different symptom. Section 1 covers both in one pass.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Migration status checklist — which of 0007-0011 have actually run.
--    Read every row: 'yes' means that migration's tell-tale schema change
--    is present, 'no' means it (almost certainly) still needs to be run.
--    Run them in the Supabase SQL editor in order — 0007, 0008, 0009, 0010,
--    0011, then 0011_diagnostic.sql, then 0011b_athletes_club_id_repair.sql
--    if that one's diagnostic step says you need it — before re-testing
--    anything below.
-- ───────────────────────────────────────────────────────────────────────
select
  '0007_gym_supersets' as migration,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_session_items' and column_name = 'superset_id'
  ) as applied
union all
select
  '0008_gym_item_types_and_fields',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_session_items' and column_name = 'load_kg'
  )
union all
select
  '0009_gym_conditioning_running_lists',
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'gym_conditioning_exercises'
  )
union all
select
  '0010_gym_exercise_group_type_hierarchy_and_sections',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_exercise_group_types' and column_name = 'body_region'
  )
union all
select
  '0011_club_ringfencing_and_user_management',
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ringfence_user_profiles_self_select'
  );

-- ───────────────────────────────────────────────────────────────────────
-- 2. Aiden-specific check — two steps, run in order (user_profiles has no
--    email column at all — confirmed by the error this originally hit —
--    so this can't be done as a single join on email; it goes through
--    auth.users first, then user_profiles by id, separately).
-- ───────────────────────────────────────────────────────────────────────

-- 2a. Find his real login account and copy its id.
select id as auth_id, email
from auth.users
where email = 'REPLACE_WITH_AIDEN_OAKLEYS_EMAIL@example.com';

-- 2b. Paste that id into both places below (replacing
--     PASTE_AUTH_ID_FROM_2a_HERE, in the quotes) and run this. Matches by
--     id (the row the self-select policy would actually find for him) OR
--     by name (so a mismatched-id row still turns up instead of being
--     invisible). Read id_matches_auth on every row that comes back:
--       - one row, id_matches_auth = true  → his profile is fine; the
--         cause is elsewhere (most likely: migrations not yet run, see
--         section 1 above).
--       - one row, id_matches_auth = false → found by name only, not by
--         id — his profile's id doesn't match his real login. That row
--         needs its id corrected (or the row recreated with the right id)
--         before he can ever pass the self-select policy.
--       - more than one row → duplicate profiles for him; maybeSingle()
--         errors on this, and the app's retry loop silently turns that
--         into the same "not found" message.
--       - zero rows → no profile exists for him at all, under either id
--         or name — he needs one created.
select id as profile_id, club_id, role, is_active, full_name,
       (id = 'PASTE_AUTH_ID_FROM_2a_HERE') as id_matches_auth
from user_profiles
where id = 'PASTE_AUTH_ID_FROM_2a_HERE'
   or full_name ilike '%Aiden Oakley%';

-- ───────────────────────────────────────────────────────────────────────
-- 3. Every policy currently active on user_profiles, whatever ran or
--    didn't — the ground truth of what's actually being enforced right
--    now, independent of what any migration file says it should be.
-- ───────────────────────────────────────────────────────────────────────
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'user_profiles'
order by policyname;
