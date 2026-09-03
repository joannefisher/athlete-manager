'use client';

// components/Gym.tsx
// Top-level Gym app — a sibling of TrainingPlanner/RehabPlanner/MainSchedule,
// opened from the app selector in AthleteManager.tsx. Coaches (and Admin/S&C/
// Physio) plan strength & conditioning sessions per athlete or per gym-only
// group; Players see only their own sessions plus their default-exercise
// settings. Follows the same sidebar shell as RehabPlanner/MainSchedule so it
// looks and feels native to the rest of the app.

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, ChevronLeft, Dumbbell, Library, Loader2, Settings, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Role } from './AthleteManager';
import { GymUI2Root } from './gym/GymUI2Root';
import { PlayerSessionsView, PlayerDefaultsView } from './gym/PlayerGymView';
import { ExerciseBankAdmin } from './gym/ExerciseBankAdmin';
import { GroupPicker } from './gym/GroupPicker';
import { GymSetup } from './gym/GymSetup';
import { fetchSessionGroups } from './gym/gymApi';
import { gymCanEdit } from './gym/permissions';
import { GymUndoProvider, GymUndoButton } from './gym/GymUndoContext';
import type { GymAthlete, GymSessionGroup, GymTeamPosition } from './gym/types';

type Page = 'sessions' | 'groups' | 'exercise-bank' | 'defaults' | 'setup';

export function Gym({ role, clubId, authUser, onBack }: { role: Role; clubId: string; authUser: any; onBack: () => void }) {
  // Admin can impersonate other roles to preview their view — same pattern
  // as TrainingPlanner/RehabPlanner's "View as" (2026-09-03).
  const [viewingAs, setViewingAs] = useState<Role>(role);
  useEffect(() => { setViewingAs(role); }, [role]);
  const effectiveRole: Role = role === 'Admin' ? viewingAs : role;

  const isPlayer = effectiveRole === 'Player';
  const canEdit = gymCanEdit(effectiveRole);

  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<GymAthlete[]>([]);
  const [teamStructure, setTeamStructure] = useState<GymTeamPosition[]>([]);
  const [sessionGroups, setSessionGroups] = useState<GymSessionGroup[]>([]);
  const [linkedAthleteId, setLinkedAthleteId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('sessions');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('full_name, linked_athlete_id')
        .eq('id', authUser.id)
        .maybeSingle();
      if (profileErr) console.error('[Gym] failed to load profile', profileErr.message);
      if (!cancelled) setMyName(profile?.full_name ?? null);

      if (isPlayer) {
        if (!cancelled) setLinkedAthleteId(profile?.linked_athlete_id ?? null);
      } else {
        // Position data (team_structure/athlete_positions) mirrors TrainingPlanner.tsx's own
        // fetch — no explicit club_id filter there either (RLS-scoped), so athlete_positions
        // rows are filtered client-side to this club's athlete ids as a defensive measure.
        const [{ data: athleteRows, error: athErr }, { data: positionRows }, { data: teamStructureRows }] = await Promise.all([
          supabase.from('athletes').select('id, name, avatar').eq('club_id', clubId).order('name'),
          supabase.from('athlete_positions').select('*'),
          supabase.from('team_structure').select('*').order('number'),
        ]);
        if (athErr) console.error('[Gym] failed to load athletes', athErr.message);
        const athleteIds = new Set((athleteRows || []).map((a: any) => a.id));
        const positionsByAthlete = new Map<string, number[]>();
        for (const p of positionRows || []) {
          if (!athleteIds.has(p.athlete_id)) continue;
          if (!positionsByAthlete.has(p.athlete_id)) positionsByAthlete.set(p.athlete_id, []);
          positionsByAthlete.get(p.athlete_id)!.push(p.position_number);
        }
        if (!cancelled) {
          setAthletes(
            (athleteRows || []).map((a: any) => ({ id: a.id, name: a.name, avatar: a.avatar, positionNumbers: positionsByAthlete.get(a.id) || [] }))
          );
          setTeamStructure((teamStructureRows || []).map((t: any) => ({ id: t.id, number: t.number, name: t.name, group: t.position_group })));
        }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [isPlayer, clubId, authUser?.id]);

  // Gym-only session groups, fetched here (not just inside GymRoot/GymUI2Root)
  // so "Manage Groups" can live as its own sidebar page shared by both UI
  // versions, rather than a screen tucked inside each one separately.
  const loadSessionGroups = useCallback(async () => {
    if (isPlayer) return;
    try {
      setSessionGroups(await fetchSessionGroups(clubId));
    } catch (err) {
      console.error('[Gym] failed to load session groups', err);
    }
  }, [isPlayer, clubId]);

  useEffect(() => { loadSessionGroups(); }, [loadSessionGroups]);

  const navItems: { id: Page; label: string; Icon: any }[] = isPlayer
    ? [
        { id: 'sessions', label: 'My Sessions', Icon: Dumbbell },
        { id: 'defaults', label: 'My Defaults', Icon: Settings },
      ]
    : [
        { id: 'sessions', label: 'Sessions', Icon: Dumbbell },
        ...(canEdit ? [{ id: 'groups' as Page, label: 'Groups', Icon: Users }] : []),
        { id: 'exercise-bank', label: 'Exercises', Icon: Library },
        ...(canEdit ? [{ id: 'setup' as Page, label: 'Setup', Icon: Settings }] : []),
      ];

  const pageTitle = {
    sessions: isPlayer ? 'My Sessions' : 'Gym Sessions',
    groups: 'Manage Groups',
    'exercise-bank': 'Exercises',
    defaults: 'My Defaults',
    setup: 'Setup',
  }[page];

  return (
    <GymUndoProvider>
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar — same shell pattern as RehabPlanner/MainSchedule, shown to every role including Player */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] mb-3 transition-colors">
            <ArrowLeft className="w-3 h-3" />All Apps
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-orange-600 flex items-center justify-center shrink-0">
              <Dumbbell className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold text-slate-100 tracking-tight">Gym</span>
          </div>
        </div>
        <nav className="flex-1 p-2 pt-3 space-y-0.5">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] px-2.5 pb-2">Menu</p>
          {navItems.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPage(id)}
              className={`w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 text-[13px] transition-colors relative ${page === id ? 'bg-white/[0.08] text-slate-100 font-medium' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/70'}`}>
              {page === id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-orange-400 rounded-r" />}
              <Icon className="w-3.5 h-3.5 shrink-0" />{label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          {role === 'Admin' && (
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">View as</p>
              <select value={viewingAs} onChange={e => { setViewingAs(e.target.value as Role); setPage('sessions'); }}
                className="w-full h-7 px-2 text-[11px] rounded bg-white/[0.06] text-white/70 border border-white/10 focus:outline-none">
                {(['Admin', 'S&C', 'Physio', 'Coach', 'Player'] as Role[]).map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)}
              </select>
            </div>
          )}
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">Signed in</p>
          <p className="text-[11px] text-white/50 truncate">{myName || authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{effectiveRole}</p>
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
          <h1 className="text-[15px] font-semibold text-slate-900 flex-1">Gym</h1>
          <div className="flex bg-slate-100 rounded-md p-0.5 text-[11px] font-medium">
            {navItems.map(({ id, label }) => (
              <button key={id} onClick={() => setPage(id)} className={`px-2 py-1 rounded ${page === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                {label.replace('My ', '')}
              </button>
            ))}
          </div>
          {!isPlayer && <GymUndoButton variant="mobile" />}
        </header>

        {/* Desktop page header */}
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-none">{pageTitle}</h2>
            <p className="text-[11px] text-slate-400 mt-1 font-light">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {!isPlayer && (
            <div className="flex items-center gap-3">
              {/* Undo lives here — on the main content header, not tucked into the sidebar — so it's visible whatever page is open. */}
              <GymUndoButton variant="canvas" />
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : isPlayer ? (
          !linkedAthleteId ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center border border-slate-200">
                <p className="text-slate-700 font-medium mb-2">No player profile linked</p>
                <p className="text-slate-400 text-sm">Ask your club admin to link your login to an athlete record.</p>
              </div>
            </div>
          ) : page === 'defaults' ? (
            <PlayerDefaultsView athleteId={linkedAthleteId} clubId={clubId} userId={authUser.id} />
          ) : (
            <PlayerSessionsView athleteId={linkedAthleteId} />
          )
        ) : page === 'groups' ? (
          <GroupPicker
            clubId={clubId}
            userId={authUser.id}
            athletes={athletes}
            teamStructure={teamStructure}
            sessionGroups={sessionGroups}
            onChanged={loadSessionGroups}
            onBack={() => setPage('sessions')}
          />
        ) : page === 'exercise-bank' ? (
          <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-3 w-full">
            <ExerciseBankAdmin clubId={clubId} currentUserId={authUser.id} canEdit={canEdit} role={effectiveRole} />
          </div>
        ) : page === 'setup' ? (
          <GymSetup clubId={clubId} userId={authUser.id} role={effectiveRole} teamStructure={teamStructure} />
        ) : (
          <GymUI2Root athletes={athletes} teamStructure={teamStructure} role={effectiveRole} userId={authUser.id} clubId={clubId} />
        )}
      </div>
    </div>
    </GymUndoProvider>
  );
}
