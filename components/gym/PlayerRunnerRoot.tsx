// components/gym/PlayerRunnerRoot.tsx
// Entirely new, dedicated mobile-first shell for Players — replaces the old
// isPlayer branch in Gym.tsx (which mounted PlayerSessionsView/
// PlayerDefaultsView inside the shared staff sidebar shell). Players get
// their own minimal chrome instead: a compact top bar, no desktop sidebar,
// designed mobile-first per Joanne's brief ("default device is mobile").
//
// Three local views, switched entirely client-side (no routing library in
// this app): 'today' (the calendar/session list — also where Pause always
// returns to), 'runner' (the step-by-step session), and 'defaults' (My
// Defaults — untouched PlayerDefaultsView from PlayerGymView.tsx).

import React, { useState } from 'react';
import { ChevronLeft, Dumbbell, Settings, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PlayerDefaultsView } from './PlayerGymView';
import { PlayerTodayView } from './PlayerTodayView';
import { PlayerSessionRunner } from './PlayerSessionRunner';

type PlayerView = 'today' | 'defaults' | 'runner';

export function PlayerRunnerRoot({
  athleteId,
  clubId,
  userId,
  loading,
  onBack,
}: {
  /** The Player's linked athlete id (user_profiles.linked_athlete_id) — null if their login isn't linked to an athlete record yet. */
  athleteId: string | null;
  clubId: string;
  userId: string;
  /** True while Gym.tsx is still resolving the caller's profile/linked athlete. */
  loading: boolean;
  onBack: () => void;
}) {
  const [view, setView] = useState<PlayerView>('today');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const openRunner = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setView('runner');
  };
  const returnToToday = () => {
    setActiveSessionId(null);
    setView('today');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!athleteId) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <PlayerTopBar title="Gym" onBack={onBack} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center border border-slate-200">
            <p className="text-slate-700 font-medium mb-2">No player profile linked</p>
            <p className="text-slate-400 text-sm">Ask your club admin to link your login to an athlete record.</p>
          </div>
        </div>
      </div>
    );
  }

  // The runner takes over the whole screen while a session is in progress —
  // no bottom nav, and its own Pause button (top bar) returns to Today
  // rather than sharing this shell's header.
  if (view === 'runner' && activeSessionId) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <PlayerSessionRunner
          sessionId={activeSessionId}
          athleteId={athleteId}
          clubId={clubId}
          userId={userId}
          onPaused={returnToToday}
          onCompleted={returnToToday}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PlayerTopBar title={view === 'defaults' ? 'My Defaults' : 'My Sessions'} onBack={onBack} onSignOut={() => supabase.auth.signOut()} />

      <div className="flex-1">
        {view === 'defaults' ? (
          <PlayerDefaultsView athleteId={athleteId} clubId={clubId} userId={userId} />
        ) : (
          <PlayerTodayView athleteId={athleteId} onOpenRunner={openRunner} />
        )}
      </div>

      {/* Bottom nav — two tabs, mobile-first (also usable, just narrower, on desktop). */}
      <nav className="sticky bottom-0 bg-white border-t border-slate-200 flex">
        <button
          onClick={() => setView('today')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${view === 'today' ? 'text-slate-900' : 'text-slate-400'}`}
        >
          <Dumbbell className="w-4 h-4" /> My Sessions
        </button>
        <button
          onClick={() => setView('defaults')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${view === 'defaults' ? 'text-slate-900' : 'text-slate-400'}`}
        >
          <Settings className="w-4 h-4" /> My Defaults
        </button>
      </nav>
    </div>
  );
}

function PlayerTopBar({ title, onBack, onSignOut }: { title: string; onBack: () => void; onSignOut?: () => void }) {
  return (
    <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
      <button onClick={onBack} className="p-1.5 -ml-1.5 hover:bg-slate-100 rounded-lg">
        <ChevronLeft className="w-5 h-5 text-slate-600" />
      </button>
      <h1 className="text-[15px] font-semibold text-slate-900 flex-1">{title}</h1>
      {onSignOut && (
        <button onClick={onSignOut} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Sign out">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      )}
    </header>
  );
}
