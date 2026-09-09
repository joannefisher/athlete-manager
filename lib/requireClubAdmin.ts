// lib/requireClubAdmin.ts
// Shared caller-verification for the admin-only API routes under
// app/api/admin/*. Those routes use the service-role key and so bypass RLS
// entirely — without a check like this they'd be wide open to anyone who
// could reach the URL. This mirrors the same check every ringfencing RLS
// policy already makes in the database (migration 0011): the caller must be
// an active Admin, and every write happens inside THEIR OWN club_id — never
// one a client could pass in — exactly like every other admin write in this
// app already works.
import type { NextRequest } from 'next/server';
import { getSupabaseAdmin } from './supabaseAdmin';

// NOTE: deliberately a single flat shape (not a discriminated `{ok:true,...}
// | {ok:false,...}` union) — under this project's tsconfig (target es2015 +
// isolatedModules + bundler resolution) `if (!auth.ok) return auth.error`
// fails to narrow and tsc reports auth.error/auth.status as missing,
// confirmed via an isolated repro. A flat "everything optional" shape
// sidesteps that entirely: every field always exists on the type (possibly
// undefined), and callers check `auth.ok` before reading the rest.
export type ClubAdminCheck = {
  ok: boolean;
  callerId?: string;
  clubId?: string;
  status?: number;
  error?: string;
};

export async function requireClubAdmin(req: NextRequest): Promise<ClubAdminCheck> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: 'Not signed in.' };

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401, error: 'Your session has expired — sign in again.' };

  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('club_id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileErr || !profile) return { ok: false, status: 403, error: 'No club profile found for your account.' };
  if (!profile.is_active) return { ok: false, status: 403, error: 'Your account is inactive.' };
  if (profile.role !== 'Admin') return { ok: false, status: 403, error: 'Only Admins can do this.' };

  return { ok: true, callerId: userData.user.id, clubId: profile.club_id as string };
}
