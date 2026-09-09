-- 0016_player_username_login.sql
-- Round 30 (2026-09-09): players don't have their own email address, and
-- Joanne doesn't want a player's account tied to their personal email even
-- when they do have one — an account should be fully controlled by the
-- club (created, password-reset, and cut off on deactivation) rather than
-- reachable via an inbox the player keeps after they leave. So player
-- accounts now log in with a club-assigned USERNAME + password instead of
-- an email address.
--
-- This migration only adds a `username` column + a case-insensitive unique
-- index to user_profiles — it deliberately does NOT touch auth.users or
-- auth.identities directly. Account creation and password-setting for
-- username-based accounts happens through two new server-side API routes
-- (app/api/admin/create-player/route.ts, app/api/admin/reset-player-password/
-- route.ts) that use Supabase's official Admin API (supabase.auth.admin.*)
-- with the project's service-role key, which only that server code holds.
-- That's a deliberate choice over writing bcrypt hashes straight into
-- auth.users from SQL (the other way to do this without a server key) —
-- the Admin API is version-stable and officially supported, where the raw
-- auth-schema approach is not.
--
-- A username-based account still has a real row in auth.users (Supabase
-- requires an email internally), but that email is a synthetic,
-- non-deliverable address the app derives from the username itself
-- (`<username>@players.invalid` — `.invalid` is the IANA-reserved TLD for
-- exactly this purpose, RFC 2606), never the player's own address. Nothing
-- is ever sent to it. Because Supabase already enforces email uniqueness
-- on auth.users, and the synthetic email is a deterministic lowercase
-- function of the username, that alone guarantees usernames are unique
-- app-wide — the index below is a defence-in-depth / display-consistency
-- backstop, not the only thing enforcing it.
--
-- Existing (staff) accounts are completely untouched — they keep signing in
-- with a real email address and the existing "send password reset email"
-- flow, exactly as today.

alter table user_profiles add column if not exists username text;

-- Case-insensitive uniqueness, and only applies to rows that actually have
-- a username (staff rows stay null forever, so this never constrains them).
create unique index if not exists user_profiles_username_unique_idx
  on user_profiles (lower(username))
  where username is not null;

-- Read-only sanity check, safe to run any time: confirms the column/index
-- landed and shows how many accounts currently use each login style.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'username'
  ) as username_column_added,
  count(*) filter (where username is not null) as username_based_accounts,
  count(*) filter (where username is null) as email_based_accounts
from user_profiles;
