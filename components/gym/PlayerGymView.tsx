// components/gym/PlayerGymView.tsx
// Content-only views for a logged-in Player, mounted inside Gym.tsx's shared
// sidebar shell (same shell RehabPlanner/MainSchedule use for every role —
// Players get the same "All Apps"/sign-out chrome as staff, just fewer nav
// items and read-only content). Two pieces: their own Daily/Weekly sessions
// (read-only — RLS also enforces this server-side), and a settings view to
// set their own default Primary exercise per exercise group.

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, StickyNote } from 'lucide-react';
import { WeekStrip, GymViewMode, getWeekDates, todayIso } from './WeekStrip';
import { fetchAthleteSessionsForDateRange, fetchExerciseGroups, fetchExercises, fetchPlayerDefaults, setPlayerDefault } from './gymApi';
import type { GymExercise, GymExerciseGroup, GymPlayerDefaultPrimary, GymSession } from './types';

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const PlayerSessionsView = ({ athleteId }: { athleteId: string }) => {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [viewMode, setViewMode] = useState<GymViewMode>('day');
  const [sessions, setSessions] = useState<GymSession[]>([]);
  const [loading, setLoading] = useState(true);

  const dates = viewMode === 'day' ? [selectedDate] : getWeekDates(selectedDate);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchAthleteSessionsForDateRange(athleteId, dates));
    } catch (err) {
      console.error('[PlayerSessionsView] failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  }, [athleteId, dates.join(',')]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <WeekStrip selectedDate={selectedDate} onDateChange={setSelectedDate} viewMode={viewMode} onViewModeChange={setViewMode} />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
        </div>
      ) : (
        dates.map(date => {
          const session = sessions.find(s => s.date === date);
          return (
            <div key={date} className="mb-3">
              {viewMode === 'week' && <p className="text-[11px] font-semibold text-slate-400 mb-1.5 px-1">{fmtDate(date)}</p>}
              <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {(!session || (session.items || []).length === 0) && (
                  <div className="p-5 text-center text-[13px] text-slate-400">
                    {viewMode === 'day' ? `No session planned for ${fmtDate(date)}.` : 'No session.'}
                  </div>
                )}
                {(session?.items || []).map(item => (
                  <div key={item.id} className="px-3.5 py-3">
                    {item.itemType === 'exercise' ? (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-medium text-slate-800">{item.effectiveExerciseName || item.exerciseName}</span>
                          {item.isPrimary && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">Primary</span>
                          )}
                          {item.wasSwapped && (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                              <RefreshCw className="w-2.5 h-2.5" /> swapped to your default
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-slate-400 mt-0.5">
                          {[item.sets ? `${item.sets} sets` : null, item.reps ? `${item.reps} reps` : null, item.load ? `@ ${item.load}` : null]
                            .filter(Boolean)
                            .join(' × ') || 'No sets/reps/load set'}
                        </p>
                      </>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        <StickyNote className="w-3.5 h-3.5 text-slate-300 mt-0.5 flex-shrink-0" />
                        <p className="text-[13px] text-slate-700">{item.noteText}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export const PlayerDefaultsView = ({ athleteId, clubId, userId }: { athleteId: string; clubId: string; userId: string }) => {
  const [exerciseGroups, setExerciseGroups] = useState<GymExerciseGroup[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [defaults, setDefaults] = useState<GymPlayerDefaultPrimary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groups, exs, defs] = await Promise.all([
        fetchExerciseGroups(clubId),
        fetchExercises(clubId),
        fetchPlayerDefaults(athleteId),
      ]);
      setExerciseGroups(groups);
      setExercises(exs);
      setDefaults(defs);
    } finally {
      setLoading(false);
    }
  }, [clubId, athleteId]);

  useEffect(() => { load(); }, [load]);

  const handleSetDefault = async (groupId: string, exerciseId: string) => {
    setSavingGroupId(groupId);
    try {
      await setPlayerDefault(clubId, athleteId, groupId, exerciseId, userId);
      await load();
    } finally {
      setSavingGroupId(null);
    }
  };

  const defaultFor = (groupId: string) => defaults.find(d => d.exerciseGroupId === groupId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {exerciseGroups.map(group => {
          const current = defaultFor(group.id);
          const options = exercises.filter(e => e.exerciseGroupId === group.id);
          return (
            <div key={group.id} className="p-3.5">
              <p className="text-[13px] font-medium text-slate-800 mb-1.5">
                {group.name} {group.typeName && <span className="text-[11px] font-normal text-slate-400">({group.typeName})</span>}
              </p>
              <select
                value={current?.exerciseId || ''}
                onChange={e => e.target.value && handleSetDefault(group.id, e.target.value)}
                disabled={savingGroupId === group.id}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No default set</option>
                {options.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
              {options.length === 0 && <p className="text-[11px] text-slate-400 mt-1">No exercises in this group yet.</p>}
            </div>
          );
        })}
        {exerciseGroups.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">No exercise groups set up yet.</div>}
      </div>
    </div>
  );
};
