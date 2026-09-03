-- 0011_club_ringfencing_and_user_management.sql
-- Round 19 (2026-08-26): enforce club-data ringfencing at the database
-- level, plus the schema/permission changes User Management's upgrade
-- needs (deactivate instead of only hard-delete, first/last name, a
-- developer-only "super admin" escape hatch).
--
-- WHY THIS MIGRATION IS WRITTEN THE WAY IT IS:
-- This repo's migrations have only ever tracked the Gym module (0001-0010).
-- Every other table (athletes, user_profiles, team_structure, rehab_*,
-- fixtures, session_plans, ...) was created directly in the Supabase
-- dashboard, outside version control — so this migration is written WITHOUT
-- being able to see the live database's actual current schema or existing
-- RLS policies. Every action below checks information_schema before
-- touching a table or column, so nothing here can hard-fail the migration
-- if a table turns out not to exist, or a column isn't named what the app
-- code implies. Tables it could not confidently ringfence are named in a
-- NOTICE when this runs — see 0011_diagnostic.sql (delivered alongside
-- this file, NOT a migration — a one-off script to run in the Supabase SQL
-- editor) to find out why and finish the job by hand.
--
-- Gym's own tables (gym_*) already had real club-scoped RLS since round 1
-- (migration 0001) and were never flagged as a ringfencing gap — this
-- migration deliberately leaves them exactly as they are.
--
-- SAFE TO RE-RUN: every DROP POLICY / CREATE POLICY pair only ever touches
-- policies this migration itself created (named ringfence_*), after first
-- clearing whatever existed before under any name.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. user_profiles — new columns
-- ═══════════════════════════════════════════════════════════════════════

alter table user_profiles add column if not exists first_name text;
alter table user_profiles add column if not exists last_name text;

-- "Make users inactive" (User Management's new deactivate action) — an
-- inactive user keeps their row (nothing is deleted) but is locked out
-- everywhere below: every ringfencing policy in this migration requires
-- is_active = true for the ACTING user, not just the target.
alter table user_profiles add column if not exists is_active boolean not null default true;

-- The "developers only, from login" super-admin mechanism. Never settable
-- through the app, in any role, by design — see the trigger in §2. It can
-- only be flipped by someone running SQL directly against the database
-- (the Supabase SQL editor, as the project owner) — never through any
-- screen in the product. Currently grants cross-club READ only (see the
-- policies below) — Joanne's own note says this becomes a full "View as /
-- testing" super-admin feature later; broadening it beyond read is a
-- deliberate follow-up decision, not done here.
alter table user_profiles add column if not exists is_super_admin boolean not null default false;

-- Best-effort backfill so existing users get a first/last name without
-- anyone re-entering anything. full_name is untouched and stays
-- authoritative for every existing display across all four apps —
-- first_name/last_name are additive, not a replacement.
update user_profiles
set first_name = coalesce(first_name, split_part(trim(full_name), ' ', 1)),
    last_name  = coalesce(
      last_name,
      nullif(trim(substring(trim(full_name) from position(' ' in trim(full_name)) + 1)), '')
    )
where full_name is not null and trim(full_name) <> '' and (first_name is null or last_name is null);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Lock club_id and is_super_admin so no app code path can ever change
--    them — "users are created within that club and cannot move clubs",
--    and super-admin can only ever be granted by direct database access.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function prevent_privileged_user_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.club_id is distinct from old.club_id) and session_user not in ('postgres', 'service_role') then
    raise exception 'club_id cannot be changed on an existing user — users cannot move clubs';
  end if;
  if (new.is_super_admin is distinct from old.is_super_admin) and session_user not in ('postgres', 'service_role') then
    raise exception 'is_super_admin can only be changed by a developer with direct database access';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_privileged_user_profile_changes on user_profiles;
create trigger trg_prevent_privileged_user_profile_changes
  before update on user_profiles
  for each row execute function prevent_privileged_user_profile_changes();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. user_profiles — explicit RLS (hand-written, not the generic helper
--    below, since "read/edit my own row, or every row in my club if I'm an
--    active Admin, or every club's rows if I'm a super admin" doesn't fit
--    the same-shape club_id check every other table in this file uses).
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'user_profiles' loop
    execute format('drop policy %I on public.user_profiles', pol.policyname);
  end loop;
end $$;

alter table user_profiles enable row level security;

-- Everyone can always read their own row, active or not — an inactive
-- user still needs to see that they're deactivated, rather than getting a
-- blank/broken profile load.
create policy ringfence_user_profiles_self_select on public.user_profiles
  for select using (id = auth.uid());

-- An active Admin can read every profile in their own club.
create policy ringfence_user_profiles_admin_select on public.user_profiles
  for select using (
    club_id in (
      select up.club_id from user_profiles up
      where up.id = auth.uid() and up.is_active = true and up.role = 'Admin'
    )
  );

-- Super admin: read-only, every club — see the column comment in §1.
create policy ringfence_user_profiles_super_admin_select on public.user_profiles
  for select using (
    exists (select 1 from user_profiles up where up.id = auth.uid() and up.is_super_admin = true)
  );

-- Only an active Admin can write another profile, and only within their
-- own club. (club_id/is_super_admin are additionally hard-blocked by the
-- trigger in §2 regardless of what this policy would otherwise permit.)
create policy ringfence_user_profiles_admin_write on public.user_profiles
  for update using (
    club_id in (
      select up.club_id from user_profiles up
      where up.id = auth.uid() and up.is_active = true and up.role = 'Admin'
    )
  ) with check (
    club_id in (
      select up.club_id from user_profiles up
      where up.id = auth.uid() and up.is_active = true and up.role = 'Admin'
    )
  );

-- An active Admin can remove another user (never themselves) from their
-- own club.
create policy ringfence_user_profiles_admin_delete on public.user_profiles
  for delete using (
    id <> auth.uid()
    and club_id in (
      select up.club_id from user_profiles up
      where up.id = auth.uid() and up.is_active = true and up.role = 'Admin'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Generic ringfencing helper — top-level, club_id-bearing tables.
--    Drops whatever policies currently exist (under any name — we can't
--    see what they're called from this repo) and replaces them with:
--    read/write for any ACTIVE user in the same club, plus a super-admin
--    read-everywhere bypass. Skips (with a NOTICE, not an error) any
--    table or column that doesn't exist — see the file header.
--
--    Deliberately does NOT tighten who-can-write beyond "same club,
--    active user" — this migration's job is closing the cross-club gap,
--    not re-litigating which roles can edit what within a club (a
--    separate, lower-risk decision that shouldn't ride on a security fix).
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  targets text[] := array[
    -- Confirmed via existing app code's own .eq('club_id', ...) calls:
    'athletes', 'fixtures', 'rehab_components', 'rehab_status_definitions',
    'rtp_phases', 'staff_leads', 'rehab_plans',
    -- Same shape as the confirmed tables above (a club's own roster/
    -- schedule data) but not directly confirmed to have club_id — skipped
    -- automatically below if they don't:
    'team_structure', 'drill_types', 'season_dates', 'availability_records',
    'eod_reports', 'default_team', 'session_plans'
  ];
  t text;
  pol record;
begin
  foreach t in array targets loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      raise notice 'ringfencing: table % does not exist, skipped', t;
      continue;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'club_id') then
      raise notice 'ringfencing: % has no club_id column, skipped — needs a schema decision (add + backfill club_id) before it can be ringfenced', t;
      continue;
    end if;

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy ringfence_%1$s_select on public.%1$I for select using (
        club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        or exists (select 1 from user_profiles where id = auth.uid() and is_super_admin = true)
      )
    $f$, t);

    execute format($f$
      create policy ringfence_%1$s_write on public.%1$I for all using (
        club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
      ) with check (
        club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
      )
    $f$, t);

    raise notice 'ringfencing: % done', t;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. One-hop child tables — no club_id of their own, scoped through a
--    direct parent FK (which must itself carry club_id, from §4 above).
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  -- [child_table, fk_column_on_child, parent_table]
  mappings text[][] := array[
    array['athlete_positions', 'athlete_id', 'athletes'],
    array['athlete_injuries', 'athlete_id', 'athletes'],
    array['drill_type_positions', 'drill_type_id', 'drill_types'],
    array['drills', 'session_plan_id', 'session_plans'],
    array['rehab_plan_rows', 'plan_id', 'rehab_plans']
  ];
  m text[];
  child text; fk text; parent text;
  pol record;
begin
  foreach m slice 1 in array mappings loop
    child := m[1]; fk := m[2]; parent := m[3];

    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = child) then
      raise notice 'ringfencing: table % does not exist, skipped', child;
      continue;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = child and column_name = fk) then
      raise notice 'ringfencing: % has no % column, skipped', child, fk;
      continue;
    end if;
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = parent) then
      raise notice 'ringfencing: parent table % for % does not exist, skipped', parent, child;
      continue;
    end if;
    -- Guard against the exact failure mode this migration exists to avoid:
    -- if the inferred parent (e.g. drill_types, session_plans) turns out not
    -- to have club_id, the policy SQL below would reference a column that
    -- doesn't exist and throw — which, since a Supabase migration runs in one
    -- transaction, would roll back every earlier section too. Skip instead.
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = parent and column_name = 'club_id') then
      raise notice 'ringfencing: % has no club_id column, so % (via %) skipped — needs a schema decision first', parent, child, parent;
      continue;
    end if;

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = child loop
      execute format('drop policy %I on public.%I', pol.policyname, child);
    end loop;

    execute format('alter table public.%I enable row level security', child);

    execute format($f$
      create policy ringfence_%1$s_select on public.%1$I for select using (
        exists (
          select 1 from public.%3$I p
          where p.id = public.%1$I.%2$I
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
        or exists (select 1 from user_profiles where id = auth.uid() and is_super_admin = true)
      )
    $f$, child, fk, parent);

    execute format($f$
      create policy ringfence_%1$s_write on public.%1$I for all using (
        exists (
          select 1 from public.%3$I p
          where p.id = public.%1$I.%2$I
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      ) with check (
        exists (
          select 1 from public.%3$I p
          where p.id = public.%1$I.%2$I
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      )
    $f$, child, fk, parent);

    raise notice 'ringfencing: % (via %) done', child, parent;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Two-hop child tables — special-cased explicitly rather than through
--    the generic helpers above, since they need a join through an
--    intermediate table that itself has no club_id (drills, rehab_plan_rows).
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare pol record;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drill_team_assignments' and column_name='drill_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drills' and column_name='session_plan_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='session_plans' and column_name='club_id')
  then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='drill_team_assignments' loop
      execute format('drop policy %I on public.drill_team_assignments', pol.policyname);
    end loop;
    execute 'alter table public.drill_team_assignments enable row level security';
    execute $f$
      create policy ringfence_drill_team_assignments_select on public.drill_team_assignments for select using (
        exists (
          select 1 from public.drills d join public.session_plans sp on sp.id = d.session_plan_id
          where d.id = public.drill_team_assignments.drill_id
            and sp.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
        or exists (select 1 from user_profiles where id = auth.uid() and is_super_admin = true)
      )
    $f$;
    execute $f$
      create policy ringfence_drill_team_assignments_write on public.drill_team_assignments for all using (
        exists (
          select 1 from public.drills d join public.session_plans sp on sp.id = d.session_plan_id
          where d.id = public.drill_team_assignments.drill_id
            and sp.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      ) with check (
        exists (
          select 1 from public.drills d join public.session_plans sp on sp.id = d.session_plan_id
          where d.id = public.drill_team_assignments.drill_id
            and sp.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      )
    $f$;
    raise notice 'ringfencing: drill_team_assignments (via drills -> session_plans) done';
  else
    raise notice 'ringfencing: drill_team_assignments skipped — expected columns not found';
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rehab_component_entries' and column_name='plan_row_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='rehab_plan_rows' and column_name='plan_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='rehab_plans' and column_name='club_id')
  then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='rehab_component_entries' loop
      execute format('drop policy %I on public.rehab_component_entries', pol.policyname);
    end loop;
    execute 'alter table public.rehab_component_entries enable row level security';
    execute $f$
      create policy ringfence_rehab_component_entries_select on public.rehab_component_entries for select using (
        exists (
          select 1 from public.rehab_plan_rows r join public.rehab_plans p on p.id = r.plan_id
          where r.id = public.rehab_component_entries.plan_row_id
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
        or exists (select 1 from user_profiles where id = auth.uid() and is_super_admin = true)
      )
    $f$;
    execute $f$
      create policy ringfence_rehab_component_entries_write on public.rehab_component_entries for all using (
        exists (
          select 1 from public.rehab_plan_rows r join public.rehab_plans p on p.id = r.plan_id
          where r.id = public.rehab_component_entries.plan_row_id
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      ) with check (
        exists (
          select 1 from public.rehab_plan_rows r join public.rehab_plans p on p.id = r.plan_id
          where r.id = public.rehab_component_entries.plan_row_id
            and p.club_id in (select club_id from user_profiles where id = auth.uid() and is_active = true)
        )
      )
    $f$;
    raise notice 'ringfencing: rehab_component_entries (via rehab_plan_rows -> rehab_plans) done';
  else
    raise notice 'ringfencing: rehab_component_entries skipped — expected columns not found';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Done. Read the NOTICEs this migration printed (Supabase SQL editor shows
-- them under the query results) — every "skipped" line names a table that
-- still needs a manual look. Run 0011_diagnostic.sql for the full picture.
-- ═══════════════════════════════════════════════════════════════════════
