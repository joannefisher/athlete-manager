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
import { fetchAthleteSessionsForDateRange, fetchExerciseGroupTypes, fetchExercises, fetchPlayerDefaults, setPlayerDefault } from './gymApi';
import { itemDisplayName, itemMetaText } from './itemDisplay';
import { groupTypeLabel } from './GroupTypePicker';
import type { GymExercise, GymExerciseGroupType, GymPlayerDefaultPrimary, GymSession } from './types';

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
            </div>
          );
        })
      )}
    </div>
  );
};

export const PlayerDefaultsView = ({ athleteId, clubId, userId }: { athleteId: string; clubId: string; userId: string }) => {
  const [groupTypes, setGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [defaults, setDefaults] = useState<GymPlayerDefaultPrimary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [types, exs, defs] = await Promise.all([
        fetchExerciseGroupTypes(clubId),
        fetchExercises(clubId),
        fetchPlayerDefaults(athleteId),
      ]);
      setGroupTypes(types);
      setExercises(exs);
      setDefaults(defs);
    } finally {
      setLoading(false);
    }
  }, [clubId, athleteId]);

  useEffect(() => { load(); }, [load]);

  const handleSetDefault = async (typeId: string, exerciseId: string) => {
    setSavingTypeId(typeId);
    try {
      await setPlayerDefault(clubId, athleteId, typeId, exerciseId, userId);
      await load();
    } finally {
      setSavingTypeId(null);
    }
  };

  const defaultFor = (typeId: string) => defaults.find(d => d.exerciseGroupTypeId === typeId);

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
        {groupTypes.map(type => {
          const current = defaultFor(type.id);
          const options = exercises.filter(e => e.exerciseGroupTypeId === type.id);
          return (
            <div key={type.id} className="p-3.5">
              <p className="text-[13px] font-medium text-slate-800 mb-1.5">{groupTypeLabel(type)}</p>
              <select
                value={current?.exerciseId || ''}
                onChange={e => e.target.value && handleSetDefault(type.id, e.target.value)}
                disabled={savingTypeId === type.id}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No default set</option>
                {options.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
              {options.length === 0 && <p className="text-[11px] text-slate-400 mt-1">No exercises of this type yet.</p>}
            </div>
          );
        })}
        {groupTypes.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">No exercise group types set up yet.</div>}
      </div>
    </div>
  );
};
