// components/gym/StaffDailyView.tsx
// Daily roster for staff: every athlete (or a filtered subset, via the
// player selector above this in GymRoot), whether they have a Gym session
// planned for the selected date, and quick actions to create/edit/delete a
// session or open a whole gym-group's session in the bulk group editor.
// The currently-open athlete (shown in the desktop split-pane) is
// highlighted so it's clear which row the right-hand panel reflects.

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, Dumbbell, HeartPulse, Loader2, Plus, Trash2, Users } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymExerciseGroup, GymExerciseGroupType, GymSession, GymSessionGroup } from './types';
import { fetchSessionsForDate, deleteSession, getOrCreateSession, saveSessionItem } from './gymApi';
import { useGymUndo } from './GymUndoContext';

export const StaffDailyView = ({
  date,
  clubId,
  athletes,
  sessionGroups,
  exercises,
  canEdit,
  userId,
  activeAthleteId,
  rehabAthleteIds,
  onOpenSession,
  onOpenGroupSession,
  onManageGroups,
}: {
  date: string;
  clubId: string;
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  exerciseGroups: GymExerciseGroup[];
  exerciseGroupTypes: GymExerciseGroupType[];
  exercises: GymExercise[];
  canEdit: boolean;
  userId: string;
  activeAthleteId?: string | null;
  rehabAthleteIds?: Set<string>;
  onOpenSession: (athleteId: string, date: string) => void;
  onOpenGroupSession: (groupId: string, date: string) => void;
  onManageGroups: () => void;
}) => {
  const { pushUndo } = useGymUndo();
  const [sessions, setSessions] = useState<GymSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchSessionsForDate(clubId, date));
    } catch (err) {
      console.error('[StaffDailyView] failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  }, [clubId, date]);

  useEffect(() => { load(); }, [load]);

  const sessionByAthlete = new Map(sessions.map(s => [s.athleteId, s]));

  const handleDelete = async (e: React.MouseEvent, session: GymSession, athleteName: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this session?')) return;
    const itemsSnapshot = [...(session.items || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    await deleteSession(session.id);
    load();
    pushUndo({
      label: `Restore ${athleteName}'s session`,
      run: async () => {
        const restored = await getOrCreateSession(clubId, session.athleteId, session.date, userId, session.sourceGroupId);
        for (const item of itemsSnapshot) {
          const draft = {
            itemType: item.itemType,
            exerciseId: item.exerciseId,
            sets: item.sets,
            reps: item.reps,
            load: item.load,
            isPrimary: item.isPrimary,
            side: item.side,
            noteText: item.noteText,
          };
          const exerciseGroupId = item.itemType === 'exercise' ? exercises.find(ex => ex.id === item.exerciseId)?.exerciseGroupId || null : null;
          await saveSessionItem(restored.id, session.athleteId, draft, exerciseGroupId, item.sortOrder, userId);
        }
        load();
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {canEdit && (
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <button
              onClick={() => setShowGroupMenu(v => !v)}
              disabled={sessionGroups.length === 0}
              className="w-full h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Users className="w-3.5 h-3.5" />
              Group session…
            </button>
            {showGroupMenu && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {sessionGroups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => { setShowGroupMenu(false); onOpenGroupSession(g.id, date); }}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span>{g.name}</span>
                    <span className="text-[11px] text-slate-400">{g.memberAthleteIds.length} players</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onManageGroups}
            className="h-9 px-3 flex items-center gap-1.5 text-[13px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            Manage groups
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {athletes.map(athlete => {
          const session = sessionByAthlete.get(athlete.id);
          const itemCount = session?.items?.length ?? 0;
          const active = athlete.id === activeAthleteId;
          return (
            <button
              key={athlete.id}
              onClick={() => onOpenSession(athlete.id, date)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 text-left relative ${active ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
            >
              {active && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />}
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[12px] font-semibold text-slate-500 flex-shrink-0">
                {athlete.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-slate-800 truncate flex items-center gap-1.5">
                  {athlete.name}
                  {rehabAthleteIds?.has(athlete.id) && (
                    <span title="On the rehab plan this week" className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                      <HeartPulse className="w-2.5 h-2.5" /> Rehab
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Dumbbell className="w-3 h-3" />
                  {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? 's' : ''} planned` : 'No session planned'}
                </p>
              </div>
              {canEdit && session && (
                <span onClick={e => handleDelete(e, session, athlete.name)} className="p-1.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              )}
              {canEdit && !session && <Plus className="w-4 h-4 text-slate-300" />}
              <ChevronRight className="w-4 h-4 text-slate-300 md:hidden" />
            </button>
          );
        })}
        {athletes.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">No players match the current filter.</div>}
      </div>
    </div>
  );
};
