// app/api/admin/reset-player-password/route.ts
// Round 30: directly sets a new password for a username-based (player)
// account — the only login style where this is possible, since there's no
// real inbox to send a reset link to. Staff (email-based) accounts are
// deliberately excluded below: they keep using
// supabase.auth.resetPasswordForEmail (see AthleteManager.tsx's
// sendPasswordReset), which never lets an admin see or set someone else's
// password. That guarantee stays intact for every account except the
// username-only ones that have no other way to recover access.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireClubAdmin } from '@/lib/requireClubAdmin';

export async function POST(req: NextRequest) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const targetUserId = String(body?.userId || '');
  const newPassword = String(body?.password || '');
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (newPassword.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });

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
    return NextResponse.json({ error: 'This account signs in with an email address — use "Send password reset" instead.' }, { status: 400 });
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, { password: newPassword });
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
