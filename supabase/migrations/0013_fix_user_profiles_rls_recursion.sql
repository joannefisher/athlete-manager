-- 0013_fix_user_profiles_rls_recursion.sql
-- URGENT — run this in the Supabase SQL editor now. Fixes Postgres error
-- 42P17 "infinite recursion detected in policy for relation user_profiles",
-- confirmed live (Aiden Oakley's exact loadProfile() request returned this
-- as a 500).
--
-- ROOT CAUSE: migration 0011 gave user_profiles four policies
-- (ringfence_user_profiles_admin_select, _admin_write, _admin_delete,
-- ringfence_user_profiles_super_admin_select) that each look up the ACTING
-- user's own role/is_active/is_super_admin via a plain subquery against
-- user_profiles itself, e.g.:
--   club_id in (select up.club_id from user_profiles up
--               where up.id = auth.uid() and up.is_active = true and up.role = 'Admin')
-- Because that subquery targets the very table the policy is attached to,
-- and RLS is enabled on it, Postgres must apply user_profiles' own row
-- security to the subquery's scan too — which means evaluating these same
-- four policies again, which subquery user_profiles again, forever.
-- Postgres detects this at query-plan time and raises 42P17 for EVERY
-- query against user_profiles by any role subject to RLS — not just for
-- Aiden, and not just for user_profiles itself: every other ringfenced
-- table (athletes, fixtures, rehab_*, team_structure, ...) also subqueries
-- user_profiles inside its own policies (migration 0011 §4-6), so this
-- almost certainly broke access to those too, for every non-admin request
-- that needed to resolve "is the acting user active/in this club" — the
-- moment migration 0011 was applied.
--
-- FIX: move the "look up my own row's flags" lookup into a SECURITY
-- DEFINER function. Such a function runs with the privileges of its
-- owner — the role that creates it via the Supabase SQL editor, which
-- bypasses row-level security entirely — so its internal query against
-- user_profiles does not re-trigger this table's policies, breaking the
-- recursion. This is the standard, documented fix for this exact class of
-- Postgres/Supabase RLS bug. `ringfence_user_profiles_self_select`
-- (id = auth.uid()) never referenced user_profiles and was never part of
-- the recursion — left untouched.
--
-- Fixing these four policies is enough to fix the whole app: every other
-- table's policy that subqueries user_profiles will now get a normal,
-- non-recursive answer back, since user_profiles' own RLS no longer loops.
-- No other table's policies need to change.
--
-- SAFE TO RE-RUN: uses create-or-replace and drop-if-exists throughout.

create or replace function public.current_user_profile_flags()
returns table (club_id uuid, role text, is_active boolean, is_super_admin boolean)
language sql
security definer
stable
set search_path = public
as $$
  select up.club_id, up.role, up.is_active, up.is_super_admin
  from public.user_profiles up
  where up.id = auth.uid()
$$;

grant execute on function public.current_user_profile_flags() to authenticated;

drop policy if exists ringfence_user_profiles_admin_select on public.user_profiles;
create policy ringfence_user_profiles_admin_select on public.user_profiles
  for select using (
    club_id in (
      select f.club_id from public.current_user_profile_flags() f
      where f.is_active = true and f.role = 'Admin'
    )
  );

drop policy if exists ringfence_user_profiles_super_admin_select on public.user_profiles;
create policy ringfence_user_profiles_super_admin_select on public.user_profiles
  for select using (
    exists (select 1 from public.current_user_profile_flags() f where f.is_super_admin = true)
  );

drop policy if exists ringfence_user_profiles_admin_write on public.user_profiles;
create policy ringfence_user_profiles_admin_write on public.user_profiles
  for update using (
    club_id in (select f.club_id from public.current_user_profile_flags() f where f.is_active = true and f.role = 'Admin')
  ) with check (
    club_id in (select f.club_id from public.current_user_profile_flags() f where f.is_active = true and f.role = 'Admin')
  );

drop policy if exists ringfence_user_profiles_admin_delete on public.user_profiles;
create policy ringfence_user_profiles_admin_delete on public.user_profiles
  for delete using (
    id <> auth.uid()
    and club_id in (
      select f.club_id from public.current_user_profile_flags() f
      where f.is_active = true and f.role = 'Admin'
    )
  );

-- ───────────────────────────────────────────────────────────────────────
-- Verify — run this after the above. Should return your own row with no
-- error at all (this is the same shape of query loadProfile() runs).
-- ───────────────────────────────────────────────────────────────────────
select club_id, role, full_name, linked_athlete_id
from user_profiles
where id = auth.uid();
