-- 0011_diagnostic.sql
-- NOT a migration — do not add this to the migrations runner. Run it by hand
-- in the Supabase SQL editor, AFTER 0011_club_ringfencing_and_user_management.sql
-- has run, to see exactly what that migration could and couldn't ringfence.
--
-- Why this exists: 0011 was written without visibility into this project's
-- live schema (every table except gym_* was created directly in the
-- dashboard, never through a tracked migration), so it defensively skips
-- anything it isn't sure about instead of guessing. Read the NOTICEs 0011
-- printed when it ran (Supabase SQL editor shows them under the query
-- results) for the same information — this script just makes it queryable
-- and repeatable afterwards.
--
-- Run each section separately and read the results.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Every table that SHOULD hold one club's data, and whether it has the
--    club_id column 0011's ringfencing depends on. A table listed here
--    with has_club_id = false is exactly what 0011 skipped — it needs a
--    club_id column added (and backfilled for existing rows) by hand
--    before it can be ringfenced at all.
-- ───────────────────────────────────────────────────────────────────────
select
  t.table_name,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'club_id'
  ) as has_club_id,
  exists (
    select 1 from pg_class pc
    join pg_namespace pn on pn.oid = pc.relnamespace
    where pn.nspname = 'public' and pc.relname = t.table_name and pc.relrowsecurity
  ) as rls_enabled
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
  and t.table_name in (
    -- top-level, club-scoped tables 0011 targets directly
    'athletes', 'fixtures', 'rehab_components', 'rehab_status_definitions',
    'rtp_phases', 'staff_leads', 'rehab_plans', 'team_structure',
    'drill_types', 'season_dates', 'availability_records', 'eod_reports',
    'default_team', 'session_plans', 'user_profiles',
    -- one/two-hop child tables 0011 scopes via a parent join
    'athlete_positions', 'athlete_injuries', 'drill_type_positions',
    'drills', 'rehab_plan_rows', 'drill_team_assignments',
    'rehab_component_entries'
  )
order by has_club_id, t.table_name;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Any table in the list above that ISN'T public.base-table at all (a
--    typo in the app code, a view, or a table under a different name) —
--    rows here mean 0011's NOTICE said "does not exist" for that name.
-- ───────────────────────────────────────────────────────────────────────
select expected.table_name as expected_but_missing
from (values
  ('athletes'), ('fixtures'), ('rehab_components'), ('rehab_status_definitions'),
  ('rtp_phases'), ('staff_leads'), ('rehab_plans'), ('team_structure'),
  ('drill_types'), ('season_dates'), ('availability_records'), ('eod_reports'),
  ('default_team'), ('session_plans'), ('user_profiles'),
  ('athlete_positions'), ('athlete_injuries'), ('drill_type_positions'),
  ('drills'), ('rehab_plan_rows'), ('drill_team_assignments'),
  ('rehab_component_entries')
) as expected(table_name)
where not exists (
  select 1 from information_schema.tables t
  where t.table_schema = 'public' and t.table_name = expected.table_name and t.table_type = 'BASE TABLE'
);

-- ───────────────────────────────────────────────────────────────────────
-- 3. Every RLS policy currently in place, per table — confirms 0011's
--    ringfence_* policies are the only ones left on the tables it touched,
--    and shows what's (or isn't) protecting everything else.
-- ───────────────────────────────────────────────────────────────────────
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ───────────────────────────────────────────────────────────────────────
-- 4. Tables with RLS NOT enabled at all — the highest-priority gap list.
--    Any club-data table here has zero row-level protection regardless of
--    what policies exist, until RLS is turned on for it.
-- ───────────────────────────────────────────────────────────────────────
select pc.relname as table_name
from pg_class pc
join pg_namespace pn on pn.oid = pc.relnamespace
where pn.nspname = 'public' and pc.relkind = 'r' and not pc.relrowsecurity
order by pc.relname;

-- ───────────────────────────────────────────────────────────────────────
-- 5. Sanity check on the new user_profiles columns 0011 added.
-- ───────────────────────────────────────────────────────────────────────
select
  count(*) as total_users,
  count(*) filter (where first_name is null or last_name is null) as missing_first_or_last_name,
  count(*) filter (where is_active = false) as inactive_users,
  count(*) filter (where is_super_admin = true) as super_admins
from user_profiles;

-- If missing_first_or_last_name > 0: those users had a null/blank
-- full_name at migration time (nothing to split), and will need a name
-- entered once through the new "update user details" screen — no data
-- was lost, there was simply nothing to backfill from.

-- If super_admins = 0: expected — 0011 never grants is_super_admin to
-- anyone (its trigger blocks the app from ever doing so). To grant it to
-- a developer login, run, as the project owner, directly in this editor:
--   update user_profiles set is_super_admin = true where id = '<user id>';
-- This only works from here (or another direct-database connection) —
-- the trigger in 0011 blocks this exact statement if it's ever attempted
-- through the app's normal (authenticated-role) connection.
