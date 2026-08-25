'use client';

import React, { useState, useEffect } from 'react';
import { Target, Zap, Calendar, Loader2, X, AlertCircle, Check, Plus, Trash2, Users, Link, Dumbbell } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TrainingPlanner } from './TrainingPlanner';
import { MainSchedule } from './MainSchedule';
import { RehabPlanner } from './RehabPlanner';
import { Gym } from './Gym';

// ── Types ────────────────────────────────────────────────────────────────────
export type Role = 'Admin' | 'S&C' | 'Physio' | 'Coach' | 'Player';

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
    allowedRoles: ['Admin', 'S&C', 'Physio', 'Coach', 'Player'],
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
const UserManagementPanel = ({ clubId, currentUserId }: { clubId: string; currentUserId: string }) => {
  const ALL_ROLES: Role[] = ['Admin', 'Coach', 'Physio', 'S&C', 'Player'];
  const [users, setUsers] = useState<any[]>([]);
  const [athletes, setAthletes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Coach');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: emailData }, { data: athleteData }] = await Promise.all([
      supabase.from('user_profiles').select('id, role, full_name, linked_athlete_id, created_at').eq('club_id', clubId).order('full_name'),
      supabase.rpc('get_user_emails', { club_uuid: clubId }),
      supabase.from('athletes').select('id, name').order('name'),
    ]);
    const emailMap: Record<string, string> = {};
    (emailData || []).forEach((r: any) => { emailMap[r.id] = r.email; });
    setUsers((data || []).map((u: any) => ({ ...u, email: emailMap[u.id] || '—' })));
    setAthletes(athleteData || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const updateUserRole = async (userId: string, newRole: Role) => {
    await supabase.from('user_profiles').update({ role: newRole }).eq('id', userId).eq('club_id', clubId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const linkAthlete = async (userId: string, athleteId: string | null) => {
    await supabase.from('user_profiles').update({ linked_athlete_id: athleteId || null }).eq('id', userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, linked_athlete_id: athleteId } : u));
    setLinkingUserId(null);
  };

  const removeUser = async (userId: string) => {
    if (!confirm('Remove this user from the club?')) return;
    await supabase.from('user_profiles').delete().eq('id', userId).eq('club_id', clubId);
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  const inviteUser = async () => {
    if (!inviteEmail.trim()) { setInviteError('Email is required'); return; }
    setInviting(true); setInviteError(''); setInviteSuccess('');
    const { error } = await supabase.rpc('invite_user_to_club', {
      invite_email: inviteEmail.trim(), invite_role: inviteRole,
      invite_name: inviteName.trim(), club_uuid: clubId,
    });
    if (error) { setInviteError(error.message); } else {
      setInviteSuccess(`Invite sent to ${inviteEmail}`);
      setInviteEmail(''); setInviteName(''); setInviteRole('Coach');
      load();
    }
    setInviting(false);
  };

  const roleColor: Record<string, string> = {
    Admin: 'bg-red-100 text-red-700', Coach: 'bg-blue-100 text-blue-700',
    Physio: 'bg-green-100 text-green-700', 'S&C': 'bg-orange-100 text-orange-700',
    Player: 'bg-violet-100 text-violet-700',
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {users.map(user => {
        const linkedAthlete = athletes.find((a: any) => a.id === user.linked_athlete_id);
        return (
          <div key={user.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[12px] font-bold text-slate-600 shrink-0">
                {(user.full_name || user.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-900">{user.full_name || '—'}</p>
                <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${roleColor[user.role] || 'bg-slate-100 text-slate-500'}`}>{user.role}</span>
              {user.id === currentUserId
                ? <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">You</span>
                : <button onClick={() => removeUser(user.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
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
            </div>
          </div>
        );
      })}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Invite new member</p>
        <div className="space-y-2">
          <input type="text" placeholder="Full name" value={inviteName} onChange={e => setInviteName(e.target.value)}
            className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <input type="email" placeholder="Email address" value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
            className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <div className="flex gap-2">
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}
              className="flex-1 h-9 px-2 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
              {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
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
const LandingPage = ({ role, clubId, currentUserId, onOpenApp }: {
  role: Role; clubId: string; currentUserId: string; onOpenApp: (id: string) => void;
}) => {
  const [showUsers, setShowUsers] = useState(false);
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
            {role === 'Admin' && (
              <button onClick={() => setShowUsers(!showUsers)}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${showUsers ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}>
                <Users className="w-3.5 h-3.5" />Users
              </button>
            )}
            <span className="text-[11px] text-white/30 px-1">{role}</span>
            <button onClick={() => supabase.auth.signOut()}
              className="h-8 px-3 text-[12px] text-white/50 hover:text-white border border-white/10 rounded-lg hover:bg-white/[0.06] transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {showUsers && role === 'Admin' ? (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => setShowUsers(false)} className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors">← Back</button>
              <h2 className="text-[18px] font-bold text-slate-900">User Management</h2>
            </div>
            <UserManagementPanel clubId={clubId} currentUserId={currentUserId} />
          </div>
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
};

// ── Root component ────────────────────────────────────────────────────────────
export default function AthleteManager() {
  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [role, setRole] = useState<Role>('Coach');
  const [clubId, setClubId] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<string | null>(null);

  const loadProfile = async (userId: string) => {
    const validRoles: Role[] = ['Admin', 'S&C', 'Physio', 'Coach', 'Player'];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('club_id, role, full_name, linked_athlete_id')
        .eq('id', userId)
        .maybeSingle();
      if (data) {
        const loadedRole = validRoles.includes((data.role || '').trim() as Role)
          ? (data.role.trim() as Role) : 'Coach';
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

  return (
    <LandingPage role={role} clubId={clubId} currentUserId={authUser.id} onOpenApp={setActiveApp} />
  );
}
