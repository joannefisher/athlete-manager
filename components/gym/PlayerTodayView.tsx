// components/gym/PlayerTodayView.tsx
// Calendar/today landing view for the Player runner shell — the screen
// Pause always returns to. Reuses WeekStrip/getWeekDates/todayIso and
// fetchAthleteSessionsForDateRange the same way the old read-only
// PlayerSessionsView (PlayerGymView.tsx) did; adds Start/Resume/Paused
// affordances for the selected date's session, driven by session.status,
// which that old view never needed since it had no runner to launch.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, StickyNote, CheckCircle2, PauseCircle } from 'lucide-react';
import { WeekStrip, GymViewMode, getWeekDates, todayIso } from './WeekStrip';
import { fetchAthleteSessionsForDateRange, startSession, resumeSession } from './gymApi';
import { itemDisplayName, itemMetaText } from './itemDisplay';
import type { GymSession } from './types';

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export function PlayerTodayView({ athleteId, onOpenRunner }: { athleteId: string; onOpenRunner: (sessionId: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [viewMode, setViewMode] = useState<GymViewMode>('day');
  const [sessions, setSessions] = useState<GymSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null); // sessionId currently starting/resuming
  const [actionError, setActionError] = useState<string | null>(null);

  const dates = viewMode === 'day' ? [selectedDate] : getWeekDates(selectedDate);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchAthleteSessionsForDateRange(athleteId, dates));
    } catch (err) {
      console.error('[PlayerTodayView] failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  }, [athleteId, dates.join(',')]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleStart = async (session: GymSession) => {
    setActionBusy(session.id);
    setActionError(null);
    try {
      await startSession(session.id);
      onOpenRunner(session.id);
    } catch (err) {
      console.error('[PlayerTodayView] failed to start session', err);
      setActionError('Could not start the session — check your connection and try again.');
      setActionBusy(null);
    }
  };

  const handleResume = async (session: GymSession) => {
    setActionBusy(session.id);
    setActionError(null);
    try {
      await resumeSession(session.id);
      onOpenRunner(session.id);
    } catch (err) {
      console.error('[PlayerTodayView] failed to resume session', err);
      setActionError('Could not resume the session — check your connection and try again.');
      setActionBusy(null);
    }
  };

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6 w-full">
      <WeekStrip selectedDate={selectedDate} onDateChange={setSelectedDate} viewMode={viewMode} onViewModeChange={setViewMode} />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
        </div>
      ) : (
        dates.map(date => {
          const session = sessions.find(s => s.date === date);
          const hasItems = !!session && (session.items || []).length > 0;
          const isSelected = date === selectedDate;
          return (
            <div key={date} className="mb-3">
              {viewMode === 'week' && <p className="text-[11px] font-semibold text-slate-400 mb-1.5 px-1">{fmtDate(date)}</p>}
              <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {!hasItems && (
                  <div className="p-5 text-center text-[13px] text-slate-400">
                    {viewMode === 'day' ? `No session planned for ${fmtDate(date)}.` : 'No session.'}
                  </div>
                )}
                {(session?.items || []).map(item => (
                  <div key={item.id} className={item.itemType === 'section' ? 'px-3.5 py-2 bg-slate-50' : 'px-3.5 py-3'}>
                    {item.itemType === 'section' ? (
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{item.sectionName}</p>
                    ) : item.itemType === 'note' ? (
                      <div className="flex items-start gap-1.5">
                        <StickyNote className="w-3.5 h-3.5 text-slate-300 mt-0.5 flex-shrink-0" />
                        <p className="text-[13px] text-slate-700">{item.noteText}</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-medium text-slate-800">{itemDisplayName(item)}</span>
                          {item.itemType === 'exercise' && item.isPrimary && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">Primary</span>
                          )}
                          {item.itemType === 'exercise' && item.wasSwapped && (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                              <RefreshCw className="w-2.5 h-2.5" /> swapped to your default
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-slate-400 mt-0.5">{itemMetaText(item)}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Start/Resume/Paused/Completed affordance — only for the currently selected date, so week view doesn't show 7 action rows at once. */}
              {isSelected && hasItems && session && (
                <div className="mt-2">
                  {session.status === 'planned' && (
                    <button
                      onClick={() => handleStart(session)}
                      disabled={actionBusy === session.id}
                      className="w-full h-12 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white text-[14px] font-semibold disabled:opacity-50"
                    >
                      {actionBusy === session.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4" /> Start session</>}
                    </button>
                  )}
                  {session.status === 'in_progress' && (
                    <button
                      onClick={() => onOpenRunner(session.id)}
                      className="w-full h-12 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white text-[14px] font-semibold"
                    >
                      <Play className="w-4 h-4" /> Continue session
                    </button>
                  )}
                  {session.status === 'paused' && (
                    <button
                      onClick={() => handleResume(session)}
                      disabled={actionBusy === session.id}
                      className="w-full h-12 flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-white text-[14px] font-semibold disabled:opacity-50"
                    >
                      {actionBusy === session.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><PauseCircle className="w-4 h-4" /> Resume session</>}
                    </button>
                  )}
                  {session.status === 'completed' && (
                    <div className="w-full h-12 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-[14px] font-semibold border border-emerald-200">
                      <CheckCircle2 className="w-4 h-4" /> Completed
                    </div>
                  )}
                  {actionError && <p className="text-[12px] text-red-600 mt-2 text-center">{actionError}</p>}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
