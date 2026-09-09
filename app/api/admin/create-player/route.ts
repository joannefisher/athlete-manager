// app/api/admin/create-player/route.ts
// Round 30: creates a username+password login for a player who has no
// email address of their own — see supabase/migrations/0016_player_username_login.sql
// for the full rationale. Only an active Admin of a club can call this, and
// the new account is always created inside THAT Admin's own club (never a
// club_id the client sends), matching every other admin write in this app.
//
// Supabase's Auth system still requires an "email" internally, so this uses
// a synthetic, never-delivered address derived from the username itself
// (`<username>@players.invalid`) — never the player's own address. Uses the
// official Admin API (supabase.auth.admin.createUser), not a direct SQL
// write into auth.users, so it stays correct across Supabase versions.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireClubAdmin } from '@/lib/requireClubAdmin';
import { isValidUsername, syntheticEmailForUsername } from '@/lib/username';

// Round 32: this used to hardcode role: 'Player' below with no way for the
// caller to say otherwise — the UI form never offered a Role field either
// (AthleteManager.tsx's "Player login (username)" mode), which blocked
// creating any non-Player username-based account (e.g. a Coach/S&C/Physio
// who also has no email address) from the User Management screen entirely.
// Mirrors the same role list the existing Email-invite path already allows
// (ALL_ROLES in AthleteManager.tsx) — this route is already gated to an
// active Admin of the target club and always creates inside that Admin's
// own club_id, same as every other write here, so there's no new privilege
// this opens up beyond what the email-invite path already allows.
const ALLOWED_ROLES = ['Admin', 'Coach', 'Physio', 'S&C', 'Player'];

export async function POST(req: NextRequest) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  const firstName = String(body?.firstName || '').trim();
  const lastName = String(body?.lastName || '').trim();
  const role = String(body?.role || 'Player').trim();
  const linkedAthleteId: string | null = body?.linkedAthleteId || null;

  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Not a valid role.' }, { status: 400 });
  }
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: 'Username must be 3-32 characters: letters, numbers, dots, dashes or underscores, and can\'t start or end with a symbol.' },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are both required.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const syntheticEmail = syntheticEmailForUsername(username);
  const fullName = `${firstName} ${lastName}`;

  // If linking to an athlete, confirm that athlete belongs to the caller's
  // own club before we use it — closes the same cross-club leak the
  // existing linkAthlete() in AthleteManager.tsx already guards against.
  if (linkedAthleteId) {
    const { data: athleteRow } = await admin.from('athletes').select('id').eq('id', linkedAthleteId).eq('club_id', auth.clubId!).maybeSingle();
    if (!athleteRow) {
      return NextResponse.json({ error: 'That athlete could not be found in your club.' }, { status: 400 });
    }
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName, login_style: 'username' },
  });
  if (createErr || !created?.user) {
    const raw = createErr?.message || '';
    const msg = /already|exists|registered/i.test(raw) ? `The username "${username}" is already taken.` : raw || 'Failed to create the login.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: profileErr } = await admin.from('user_profiles').insert({
    id: created.user.id,
    club_id: auth.clubId!,
    role,
    username,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    is_active: true,
    linked_athlete_id: linkedAthleteId,
  });
  if (profileErr) {
    // Don't leave an orphaned login with no club profile behind.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json({ error: profileErr.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id, username });
}
