-- 0018_fix_user_profiles_role_check_add_player.sql
-- Round 32 (2026-09-09): fixes a live, blocking bug reported as "Unable to
-- set role for new users using the player screen in usermanagement which
-- is blocking creating a new user."
--
-- Root cause, confirmed directly against the live database (this session
-- gained Supabase MCP access this round, for the first time — previous
-- rounds diagnosed this app with no DB access at all): user_profiles' own
-- CHECK constraint, user_profiles_role_check, only allowed
-- ('Admin','S&C','Physio','Coach') -- 'Player' was missing from it
-- entirely. This has nothing to do with 0001_gym.sql's own note ("no CHECK
-- constraint to touch") -- that comment was about a DIFFERENT, later-added
-- role concept for gym RLS; this constraint on the role COLUMN itself
-- predates every migration in this folder and was never captured in one,
-- so no earlier migration here ever had a chance to catch this.
--
-- Effect while this was live: EVERY attempt to insert a user_profiles row
-- with role = 'Player' was rejected by Postgres itself, regardless of which
-- UI path tried it -- the Email-invite flow inviting someone as Player, and
-- the username-based "Player login" flow in create-player/route.ts (which
-- always hardcoded role: 'Player'), both would have failed the same way.
-- The app's own Role type, ALL_ROLES list, and the whole player-facing
-- feature set (username login, gym groups, the Player session runner, etc.
-- -- see migrations 0015/0016) have always assumed 'Player' was a valid
-- role; the database just never actually allowed a row to say so.
--
-- Already applied directly to the live database via the Supabase MCP
-- connection this round (confirmed via pg_get_constraintdef). This file
-- exists so the fix is captured in the migration history like everything
-- else, and so a fresh database built from this migrations folder doesn't
-- reintroduce the same gap.

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role = any (array['Admin','S&C','Physio','Coach','Player']));

-- Read-only sanity check, safe to run any time.
select pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.user_profiles'::regclass and conname = 'user_profiles_role_check';
