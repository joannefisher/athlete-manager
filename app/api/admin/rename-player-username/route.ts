// app/api/admin/rename-player-username/route.ts
// Round 30 follow-up: lets an Admin change an existing username-based
// (player) account's username after it's been created. Only touches
// accounts that already have a username — staff (email-based) accounts
// don't go through here, matching how create-player/reset-player-password
// are also player-only.
//
// A username isn't just a display label — it's a deterministic function of
// the account's real (synthetic) auth email (see lib/username.ts), so
// renaming has to update BOTH auth.users.email and user_profiles.username
// together. Doing only the user_profiles side would silently break sign-in:
// the login screen would show/accept the new name, but translate it to an
// email that doesn't match any account.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireClubAdmin } from '@/lib/requireClubAdmin';
import { isValidUsername, syntheticEmailForUsername } from '@/lib/username';

export async function POST(req: NextRequest) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const targetUserId = String(body?.userId || '');
  const newUsername = String(body?.username || '').trim();
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (!isValidUsername(newUsername)) {
    return NextResponse.json(
      { error: 'Username must be 3-32 characters: letters, numbers, dots, dashes or underscores, and can\'t start or end with a symbol.' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: target, error: targetErr } = await admin
    .from('user_profiles')
    .select('club_id, username')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetErr || !target || target.club_id !== auth.clubId) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }
  if (!target.username) {
    return NextResponse.json({ error: 'This account signs in with an email address, not a username.' }, { status: 400 });
  }
  if (target.username.toLowerCase() === newUsername.toLowerCase()) {
    return NextResponse.json({ ok: true, username: target.username }); // no-op, already this username
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(targetUserId, {
    email: syntheticEmailForUsername(newUsername),
    user_metadata: { username: newUsername },
  });
  if (authErr) {
    const raw = authErr.message || '';
    const msg = /already|exists|registered/i.test(raw) ? `The username "${newUsername}" is already taken.` : raw || 'Failed to rename this login.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: profileErr } = await admin.from('user_profiles').update({ username: newUsername }).eq('id', targetUserId);
  if (profileErr) {
    // Best-effort rollback so auth.users and user_profiles don't end up
    // disagreeing about the username — if this also fails, the account is
    // left needing a manual fix, but that's surfaced via the error below
    // rather than silently mismatched.
    await admin.auth.admin.updateUserById(targetUserId, { email: syntheticEmailForUsername(target.username) }).catch(() => {});
    return NextResponse.json({ error: profileErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, username: newUsername });
}
