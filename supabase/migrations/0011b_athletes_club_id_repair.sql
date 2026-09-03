-- 0011b_athletes_club_id_repair.sql
-- NOT a migration — do not add this to the migrations runner. Run it by hand
-- in the Supabase SQL editor, section by section, AFTER 0011 has run.
--
-- WHY THIS EXISTS: every "Add Player" / "Add Athlete" / CSV-import insert
-- across this app (Training Planner, Gym's Setup page) has always created a
-- new athletes row WITHOUT setting club_id explicitly — the app code wrongly
-- assumed something on the database side filled it in automatically. There
-- never was any such thing. Before 0011, athletes had no real RLS enforcing
-- club_id, so this went unnoticed — a NULL-club_id row was still readable/
-- writable by everyone. Once 0011's stricter policies went in, two things
-- broke at once: (1) any athlete already sitting with a NULL club_id became
-- invisible in every club-scoped view (Gym Setup's "Player default
-- exercises" matrix included — this is the "doesn't show a full squad list"
-- report), and (2) creating a NEW athlete without a club_id now fails the
-- INSERT's own RLS check outright (the "Add Player doesn't allow player
-- creation" report). The app code itself has now been fixed (every
-- athletes-insert call site sets club_id explicitly) — this script is only
-- for repairing rows that were already created before that fix.

-- ───────────────────────────────────────────────────────────────────────
-- 1. How many athletes are actually affected, and how many distinct clubs
--    exist. Run this first and read the result before doing anything else.
-- ───────────────────────────────────────────────────────────────────────
select
  (select count(*) from athletes where club_id is null) as athletes_with_null_club_id,
  (select count(*) from athletes) as athletes_total,
  (select count(distinct club_id) from user_profiles where club_id is not null) as distinct_clubs;

-- ───────────────────────────────────────────────────────────────────────
-- 2A. SINGLE-CLUB CASE — if step 1 showed distinct_clubs = 1, every
--     NULL-club_id athlete unambiguously belongs to that one club. This
--     backfills them. Safe to re-run (only ever touches club_id is null
--     rows) — but read the "how many" result from step 1 first so you know
--     what to expect changing.
-- ───────────────────────────────────────────────────────────────────────
-- update athletes
-- set club_id = (select club_id from user_profiles where club_id is not null limit 1)
-- where club_id is null;

-- ───────────────────────────────────────────────────────────────────────
-- 2B. MULTI-CLUB CASE — if step 1 showed distinct_clubs > 1, do NOT run
--     2A — there's no way to know which club an orphaned athlete belongs to
--     from this script alone. Run this instead to list them for manual
--     assignment (e.g. by name, in the Training Planner or Gym Setup UI,
--     once the app code fix below makes editing them possible again) —
--     any of these rows can be assigned properly, at that point, simply by
--     saving that athlete's profile once the fixed "Add Player"/"Edit"
--     flow runs (it now always sets club_id on insert, and never overwrites
--     it on update, so open each one, confirm the right details, and save
--     any OTHER field to force a normal save through the fixed code path —
--     or ask Claude to write a one-off UPDATE for specific ids once you
--     know which club each belongs to).
-- ───────────────────────────────────────────────────────────────────────
select id, name, status, created_at
from athletes
where club_id is null
order by created_at;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Re-run after 2A (or after manually fixing the rows from 2B) to
--    confirm nothing is orphaned any more.
-- ───────────────────────────────────────────────────────────────────────
select count(*) as still_null from athletes where club_id is null;
