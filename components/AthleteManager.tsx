'use client';

import React, { useState, useEffect } from 'react';
import { Target, Zap, Calendar, Loader2, X, AlertCircle, Check, Plus, Trash2, Link, Dumbbell, Edit2, UserCog, ArrowLeft, ChevronLeft, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TrainingPlanner } from './TrainingPlanner';
import { MainSchedule } from './MainSchedule';
import { RehabPlanner } from './RehabPlanner';
import { Gym } from './Gym';

// ── Types ────────────────────────────────────────────────────────────────────
export type Role = 'Admin' | 'S&C' | 'Physio' | 'Coach' | 'Player';

// Single source of truth for "every role, in order" — this file used to list
// the five roles in two different orders in two different places
// (UserManagementPanel's ALL_ROLES and loadProfile's validRoles); consolidated
// per the consistency audit (2026-09-03).
const ALL_ROLES: Role[] = ['Admin', 'Coach', 'Physio', 'S&C', 'Player'];

// ── App definitions ──────────────────────────────────────────────────────────
interface AppDef {
  id: string;
  label: string;
  description: string;
  Icon: React.FC<any>;
  color: string;
  allowedRoles: Role[];
}

const APPS: AppDef[] = [
  {
    id: 'training-planner',
    label: 'Training Planner',
    description: 'Availability, session plans & reporting',
    Icon: Zap,
    color: 'bg-blue-600',
    allowedRoles: ['Admin', 'S&C', 'Physio', 'Coach'],
  },
  {
    id: 'rehab-planner',
    label: 'Rehab Planner',
    description: 'Weekly rehab tracking & return-to-play',
    Icon: Target,
    color: 'bg-emerald-600',
    allowedRoles: ['Admin', 'S&C', 'Physio', 'Player'],
  },
  {
    id: 'main-schedule',
    label: 'Main Schedule',
    description: 'Fixtures & club calendar',
    Icon: Calendar,
    color: 'bg-violet-600',
    allowedRoles: ['Admin', 'S&C', 'Physio', 'Coach'],
  },
  {
    id: 'gym',
    label: 'Gym',
    description: 'Strength & conditioning session plans',
    Icon: Dumbbell,
    color: 'bg-orange-600',
    // Coach removed 2026-09-03, per Joanne's explicit request — Coach no
    // longer has any access to the Gym app (was previously full edit
    // parity with Admin via gymCanEdit; see permissions.ts). Player keeps
    // today's read-only "My Sessions"/self-service "My Defaults" view for
    // now, pending a separate, purpose-built Player UI Joanne is scoping
    // next — this list is NOT the place that'll change for that; Player's
    // own Gym.tsx branch (isPlayer) is.
    allowedRoles: ['Admin', 'S&C', 'Physio', 'Player'],
  },
  {
    id: 'user-management',
    label: 'User Management',
    description: 'Manage this club\'s users, roles & access',
    Icon: UserCog,
    color: 'bg-slate-700',
    allowedRoles: ['Admin'],
  },
];

// ── Login Screen ─────────────────────────────────────────────────────────────
const LoginScreen = () => {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(error.message);
    else setMessage('Check your email for a reset link.');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center">
            <Target className="w-6 h-6 text-white" strokeWidth={2.5} />
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <h1 className="text-[18px] font-bold text-slate-900 mb-1 text-center">Athlete Manager</h1>
          <p className="text-[12px] text-slate-400 text-center mb-6">
            {mode === 'signin' ? 'Sign in to your account' : 'Reset your password'}
          </p>
          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} className="space-y-3">
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {error && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full h-10 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}Sign in
              </button>
              <button type="button" onClick={() => { setMode('reset'); setError(''); }}
                className="w-full text-center text-[12px] text-slate-400 hover:text-slate-600 transition-colors">
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-3">
              <button type="button" onClick={() => { setMode('signin'); setMessage(''); setError(''); }}
                className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-700 mb-2 transition-colors">
                ← Back to sign in
              </button>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {error && <p className="text-[11px] text-red-600">{error}</p>}
              {message && <p className="text-[11px] text-green-600">{message}</p>}
              <button type="submit" disabled={loading}
                className="w-full h-10 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50">
                {loading ? 'Sending…' : 'Send reset email'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

// ── User Management Panel ─────────────────────────────────────────────────────
// 2026-09-03 upgrade: within their own club, Admins can now set/manage roles
// (existing), create new users with required name/email/role (below),
// update an existing user's name, deactivate/reactivate a user instead of
// only hard-deleting them, and send a password reset email without ever
// seeing the password itself. Every write here was already club-scoped
// (2026-08-26 fix); this round adds is_active/first_name/last_name from
// migration 0011 on top of that.
const UserManagementPanel = ({ clubId, currentUserId }: { clubId: string; currentUserId: string }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [athletes, setAthletes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Coach');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null);
  const [editingDetailsUserId, setEditingDetailsUserId] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  // Search existing users by name (2026-09-03 fix) — the user list had no
  // filter of any kind before this.
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: emailData }, { data: athleteData }] = await Promise.all([
      supabase.from('user_profiles').select('id, role, full_name, first_name, last_name, is_active, linked_athlete_id, created_at').eq('club_id', clubId).order('full_name'),
      supabase.rpc('get_user_emails', { club_uuid: clubId }),
      // Club-scoped (2026-08-26 fix) — this was the one query in the whole
      // panel with no club_id filter, which let an Admin link a login to
      // another club's athlete record. See also linkAthlete() below.
      supabase.from('athletes').select('id, name').eq('club_id', clubId).order('name'),
    ]);
    const emailMap: Record<string, string> = {};
    (emailData || []).forEach((r: any) => { emailMap[r.id] = r.email; });
    setUsers((data || []).map((u: any) => ({ ...u, email: emailMap[u.id] || '—' })));
    setAthletes(athleteData || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const flash = (id: string, text: string, error = false) => {
    setRowMessage({ id, text, error });
    setTimeout(() => setRowMessage(cur => (cur?.id === id && cur.text === text ? null : cur)), 4000);
  };

  const updateUserRole = async (userId: string, newRole: Role) => {
    await supabase.from('user_profiles').update({ role: newRole }).eq('id', userId).eq('club_id', clubId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const linkAthlete = async (userId: string, athleteId: string | null) => {
    // Club-scoped (2026-08-26 fix), matching updateUserRole/removeUser below
    // — defense in depth now that the athletes query above is scoped too.
    await supabase.from('user_profiles').update({ linked_athlete_id: athleteId || null }).eq('id', userId).eq('club_id', clubId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, linked_athlete_id: athleteId } : u));
    setLinkingUserId(null);
  };

  const removeUser = async (userId: string) => {
    if (!confirm('Permanently remove this user from the club? This deletes their account — consider "Deactivate" instead if you just want to lock them out.')) return;
    await supabase.from('user_profiles').delete().eq('id', userId).eq('club_id', clubId);
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  // "Make users inactive" — a deactivated user's own session is locked out
  // everywhere by migration 0011's RLS policies (every ringfencing policy
  // requires the ACTING user to be is_active). Nothing is deleted, so
  // reactivating restores exactly what they had before.
  const toggleActive = async (userId: string, currentlyActive: boolean) => {
    const nextActive = !currentlyActive;
    if (nextActive === false && !confirm('Make this user inactive? They will be locked out of every app until reactivated.')) return;
    const { error } = await supabase.from('user_profiles').update({ is_active: nextActive }).eq('id', userId).eq('club_id', clubId);
    if (error) { flash(userId, error.message, true); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: nextActive } : u));
    flash(userId, nextActive ? 'Reactivated' : 'Deactivated');
  };

  const startEditDetails = (user: any) => {
    setEditingDetailsUserId(user.id);
    setEditFirstName(user.first_name || '');
    setEditLastName(user.last_name || '');
  };

  const saveUserDetails = async (userId: string) => {
    if (!editFirstName.trim() || !editLastName.trim()) { flash(userId, 'First and last name are both required', true); return; }
    setSavingDetails(true);
    const fullName = `${editFirstName.trim()} ${editLastName.trim()}`.trim();
    const { error } = await supabase.from('user_profiles')
      .update({ first_name: editFirstName.trim(), last_name: editLastName.trim(), full_name: fullName })
      .eq('id', userId).eq('club_id', clubId);
    setSavingDetails(false);
    if (error) { flash(userId, error.message, true); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, first_name: editFirstName.trim(), last_name: editLastName.trim(), full_name: fullName } : u));
    setEditingDetailsUserId(null);
    flash(userId, 'Details updated');
  };

  // "Issue password reset emails but should not be able to access or view
  // these passwords" — resetPasswordForEmail sends a reset link and never
  // returns or exposes a password to the caller; there is no admin-visible
  // password anywhere in this flow.
  const sendPasswordReset = async (userId: string, email: string) => {
    if (!email || email === '—') { flash(userId, 'No email on file for this user', true); return; }
    setResettingPasswordId(userId);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setResettingPasswordId(null);
    flash(userId, error ? error.message : `Reset email sent to ${email}`, !!error);
  };

  const inviteUser = async () => {
    const firstName = inviteFirstName.trim();
    const lastName = inviteLastName.trim();
    const email = inviteEmail.trim();
    if (!firstName || !lastName) { setInviteError('First and last name are required'); return; }
    if (!email) { setInviteError('Email is required'); return; }
    if (!inviteRole) { setInviteError('Role is required'); return; }
    setInviting(true); setInviteError(''); setInviteSuccess('');
    const fullName = `${firstName} ${lastName}`;
    // invite_user_to_club is an existing RPC whose internals we can't see
    // from this repo (created directly in the dashboard) — its signature is
    // unchanged. It's still given the combined name so full_name (which
    // every existing display across all 4 apps reads) comes out right; the
    // new first_name/last_name columns are then set with a follow-up update
    // below, since the RPC predates them and can't be safely assumed to
    // set them itself. Users are created within THIS club only — club_uuid
    // is fixed to the current club_id and the new user's club_id can never
    // be changed afterwards (migration 0011's trigger blocks it at the DB
    // level), matching "users are created within that club and cannot move
    // clubs."
    const { error } = await supabase.rpc('invite_user_to_club', {
      invite_email: email, invite_role: inviteRole,
      invite_name: fullName, club_uuid: clubId,
    });
    if (error) {
      setInviteError(error.message);
      setInviting(false);
      return;
    }
    // Follow up: find the row the RPC just created (by email, within this
    // club) and set first_name/last_name on it — the RPC's own return value
    // isn't something this repo can rely on the shape of.
    const { data: emailRows } = await supabase.rpc('get_user_emails', { club_uuid: clubId });
    const createdId = (emailRows || []).find((r: any) => (r.email || '').toLowerCase() === email.toLowerCase())?.id;
    if (createdId) {
      await supabase.from('user_profiles').update({ first_name: firstName, last_name: lastName }).eq('id', createdId).eq('club_id', clubId);
    }
    setInviteSuccess(`Invite sent to ${email}`);
    setInviteEmail(''); setInviteFirstName(''); setInviteLastName(''); setInviteRole('Coach');
    await load();
    setInviting(false);
  };

  // Deliberately avoids blue/emerald/violet/orange — those are already each
  // app's own sidebar-identity color (Training Planner/Rehab/Main Schedule/
  // Gym), and this badge meant something different (a role, not an app) in
  // the same hue — a consistency-audit fix (2026-09-03).
  const roleColor: Record<string, string> = {
    Admin: 'bg-red-100 text-red-700', Coach: 'bg-cyan-100 text-cyan-700',
    Physio: 'bg-teal-100 text-teal-700', 'S&C': 'bg-amber-100 text-amber-700',
    Player: 'bg-pink-100 text-pink-700',
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  const filteredUsers = userSearchQuery.trim()
    ? users.filter(u => (u.full_name || '').toLowerCase().includes(userSearchQuery.trim().toLowerCase()))
    : users;

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search users by name…"
          value={userSearchQuery}
          onChange={e => setUserSearchQuery(e.target.value)}
          className="w-full h-9 pl-9 pr-3 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      {filteredUsers.length === 0 && (
        <p className="text-[12px] text-slate-400 text-center py-4">No users match "{userSearchQuery}".</p>
      )}
      {filteredUsers.map(user => {
        const linkedAthlete = athletes.find((a: any) => a.id === user.linked_athlete_id);
        const isActive = user.is_active !== false;
        const isEditingDetails = editingDetailsUserId === user.id;
        const msg = rowMessage?.id === user.id ? rowMessage : null;
        return (
          <div key={user.id} className={`bg-white rounded-xl border p-4 ${isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50/60'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${isActive ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-400'}`}>
                {(user.full_name || user.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                {isEditingDetails ? (
                  <div className="flex items-center gap-1.5">
                    <input type="text" placeholder="First name" value={editFirstName} onChange={e => setEditFirstName(e.target.value)}
                      className="w-24 h-7 px-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <input type="text" placeholder="Last name" value={editLastName} onChange={e => setEditLastName(e.target.value)}
                      className="w-24 h-7 px-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button onClick={() => saveUserDetails(user.id)} disabled={savingDetails} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-40">
                      {savingDetails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => setEditingDetailsUserId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">{user.full_name || '—'}</p>
                    {!isActive && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 shrink-0">Inactive</span>}
                    <button onClick={() => startEditDetails(user)} className="p-0.5 text-slate-300 hover:text-slate-600 transition-colors shrink-0" title="Edit name">
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${roleColor[user.role] || 'bg-slate-100 text-slate-500'}`}>{user.role}</span>
              {user.id === currentUserId
                ? <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">You</span>
                : <button onClick={() => removeUser(user.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Remove permanently"><Trash2 className="w-3.5 h-3.5" /></button>
              }
            </div>

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Role:</span>
                <select value={user.role} onChange={e => updateUserRole(user.id, e.target.value as Role)}
                  disabled={user.id === currentUserId}
                  className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none disabled:opacity-40">
                  {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Athlete:</span>
                {linkingUserId === user.id ? (
                  <div className="flex items-center gap-1">
                    <select className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      defaultValue={user.linked_athlete_id || ''}
                      onChange={e => linkAthlete(user.id, e.target.value || null)}>
                      <option value="">— Unlinked —</option>
                      {athletes.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button onClick={() => setLinkingUserId(null)}><X className="w-3 h-3 text-slate-400" /></button>
                  </div>
                ) : (
                  <button onClick={() => setLinkingUserId(user.id)}
                    className="flex items-center gap-1 h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                    <Link className="w-3 h-3 text-slate-400" />
                    {linkedAthlete ? <span className="text-slate-700">{linkedAthlete.name}</span> : <span className="text-slate-400">Not linked</span>}
                  </button>
                )}
              </div>
              {user.id !== currentUserId && (
                <button onClick={() => toggleActive(user.id, isActive)}
                  className={`h-7 px-2.5 text-[11px] rounded-lg border transition-colors ${isActive ? 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                  {isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
              <button onClick={() => sendPasswordReset(user.id, user.email)} disabled={resettingPasswordId === user.id}
                className="h-7 px-2.5 text-[11px] rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1">
                {resettingPasswordId === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Send password reset
              </button>
            </div>
            {msg && <p className={`mt-2 text-[11px] flex items-center gap-1 ${msg.error ? 'text-red-600' : 'text-emerald-600'}`}>
              {msg.error ? <AlertCircle className="w-3 h-3" /> : <Check className="w-3 h-3" />}{msg.text}
            </p>}
          </div>
        );
      })}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Create new user</p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">First name <span className="text-red-500">*</span></label>
              <input type="text" value={inviteFirstName} onChange={e => { setInviteFirstName(e.target.value); setInviteError(''); }}
                className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Last name <span className="text-red-500">*</span></label>
              <input type="text" value={inviteLastName} onChange={e => { setInviteLastName(e.target.value); setInviteError(''); }}
                className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Email address <span className="text-red-500">*</span></label>
            <input type="email" value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
              className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Role <span className="text-red-500">*</span></label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}
                className="w-full h-9 px-2 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button onClick={inviteUser} disabled={inviting}
              className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
              {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              {inviting ? 'Sending…' : 'Invite'}
            </button>
          </div>
          {inviteError && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{inviteError}</p>}
          {inviteSuccess && <p className="text-[11px] text-green-600 flex items-center gap-1"><Check className="w-3 h-3" />{inviteSuccess}</p>}
        </div>
      </div>
    </div>
  );
};

// ── Landing Page ─────────────────────────────────────────────────────────────
const LandingPage = ({ role, onOpenApp }: {
  role: Role; onOpenApp: (id: string) => void;
}) => {
  const visibleApps = APPS.filter(a => a.allowedRoles.includes(role));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Target className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-bold text-white tracking-tight">Athlete Manager</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/30 px-1">{role}</span>
            <button onClick={() => supabase.auth.signOut()}
              className="h-8 px-3 text-[12px] text-white/50 hover:text-white border border-white/10 rounded-lg hover:bg-white/[0.06] transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="text-[22px] font-bold text-slate-900 mb-1">Your Apps</h2>
          <p className="text-[13px] text-slate-400">Select an app to get started</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleApps.map(app => (
            <button key={app.id} onClick={() => onOpenApp(app.id)}
              className="bg-white rounded-xl border border-slate-200 p-6 text-left hover:shadow-md hover:border-slate-300 transition-all group">
              <div className={`w-11 h-11 rounded-xl ${app.color} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                <app.Icon className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <h3 className="text-[15px] font-semibold text-slate-900 mb-1">{app.label}</h3>
              <p className="text-[12px] text-slate-400 leading-relaxed">{app.description}</p>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
};

// ── User Management App shell ────────────────────────────────────────────────
// Promoted from a header pill on the landing page to its own app tile
// (2026-09-03), per Joanne's answer ("User Management will become a 5th
// App"). Originally given its own minimal header-bar layout; rebuilt
// (2026-09-03, same-day follow-up) onto the exact same dark-sidebar shell
// every other app uses (Gym.tsx is the reference — see its own shell, lines
// ~123-166) per Joanne's explicit ask to align "All Apps"/"Signed in"
// structure across every app. No "View as" here — this app is already
// Admin-only, so role-impersonation doesn't apply. The nav list has exactly
// one, always-active "Users" entry — there's only one page, but this keeps
// the same visual grammar (a Menu label + highlighted current item) the
// other sidebars use rather than omitting the nav section entirely.
const UserManagementApp = ({ clubId, currentUserId, authUser, onBack }: { clubId: string; currentUserId: string; authUser: any; onBack: () => void }) => {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] mb-3 transition-colors">
            <ArrowLeft className="w-3 h-3" />All Apps
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-slate-700 flex items-center justify-center shrink-0">
              <UserCog className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold text-slate-100 tracking-tight">User Management</span>
          </div>
        </div>
        <nav className="flex-1 p-2 pt-3 space-y-0.5">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] px-2.5 pb-2">Menu</p>
          <div className="w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 text-[13px] relative bg-white/[0.08] text-slate-100 font-medium">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-red-400 rounded-r" />
            <UserCog className="w-3.5 h-3.5 shrink-0" />Users
          </div>
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">Signed in</p>
          <p className="text-[11px] text-white/50 truncate">{authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">Admin</p>
          <button onClick={() => supabase.auth.signOut()} className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors">
            <X className="w-3 h-3" />Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-[15px] font-semibold text-slate-900 flex-1">User Management</h1>
          <button onClick={() => supabase.auth.signOut()} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Sign out">
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </header>

        {/* Desktop page header */}
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-none">Users</h2>
            <p className="text-[11px] text-slate-400 mt-1 font-light">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10 w-full">
          <UserManagementPanel clubId={clubId} currentUserId={currentUserId} />
        </main>
      </div>
    </div>
  );
};

// ── Root component ────────────────────────────────────────────────────────────
export default function AthleteManager() {
  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Fails closed to the least-privileged role — see loadProfile's fallback below.
  const [role, setRole] = useState<Role>('Player');
  const [clubId, setClubId] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<string | null>(null);

  const loadProfile = async (userId: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('club_id, role, full_name, linked_athlete_id')
        .eq('id', userId)
        .maybeSingle();
      if (data) {
        // 2026-08-26: an invalid/blank role used to silently grant
        // Coach-level access. Fails closed to Player (the least-privileged
        // role) instead, per Joanne's decision.
        const loadedRole = ALL_ROLES.includes((data.role || '').trim() as Role)
          ? (data.role.trim() as Role) : 'Player';
        setRole(loadedRole);
        setClubId(data.club_id);
        // If this role only has one app available, skip straight to it
        // instead of showing a landing page with a single tile. (Players
        // used to be hardcoded to Rehab Planner here — now that they can
        // also have Gym, this generalizes to whatever the role can see.)
        const roleApps = APPS.filter(a => a.allowedRoles.includes(loadedRole));
        if (roleApps.length === 1) setActiveApp(roleApps[0].id);
        setAuthLoading(false);
        return;
      }
      if (error) console.error('[loadProfile]', error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 600));
    }
    setAuthLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setAuthUser(session.user); loadProfile(session.user.id); }
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) { setAuthUser(session.user); loadProfile(session.user.id); }
      else { setAuthUser(null); setAuthLoading(false); setActiveApp(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
    </div>
  );

  if (!authUser) return <LoginScreen />;
  if (!clubId) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <p className="text-sm text-slate-400">No club profile found. Contact your administrator.</p>
    </div>
  );

  // Route to child apps
  if (activeApp === 'training-planner')
    return <TrainingPlanner role={role} clubId={clubId} authUser={authUser} onBack={() => setActiveApp(null)} />;
  if (activeApp === 'main-schedule')
    return <MainSchedule role={role} clubId={clubId} authUser={authUser} onBack={() => setActiveApp(null)} />;
  if (activeApp === 'rehab-planner')
    return <RehabPlanner role={role} clubId={clubId} authUser={authUser} onBack={() => setActiveApp(null)} />;
  if (activeApp === 'gym')
    return <Gym role={role} clubId={clubId} authUser={authUser} onBack={() => setActiveApp(null)} />;
  if (activeApp === 'user-management')
    return role === 'Admin'
      ? <UserManagementApp clubId={clubId} currentUserId={authUser.id} authUser={authUser} onBack={() => setActiveApp(null)} />
      : <LandingPage role={role} onOpenApp={setActiveApp} />;

  return (
    <LandingPage role={role} onOpenApp={setActiveApp} />
  );
}
