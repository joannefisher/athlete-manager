// components/gym/StaffDailyView.tsx
// Daily roster for staff: every athlete (or a filtered subset, via the
// player selector above this in GymRoot), whether they have a Gym session
// planned for the selected date, and quick actions to create/edit/delete a
// session or open a whole gym-group's session in the bulk group editor.
// The currently-open athlete (shown in the desktop split-pane) is
// highlighted so it's clear which row the right-hand panel reflects.

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, Dumbbell, Loader2, Plus, Trash2, Users } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExerciseGroup, GymExerciseGroupType, GymSession, GymSessionGroup } from './types';
import { fetchSessionsForDate, deleteSession } from './gymApi';

export const StaffDailyView = ({
  date,
  clubId,
  athletes,
  sessionGroups,
  canEdit,
  userId,
  activeAthleteId,
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
  canEdit: boolean;
  userId: string;
  activeAthleteId?: string | null;
  onOpenSession: (athleteId: string, date: string) => void;
  onOpenGroupSession: (groupId: string, date: string) => void;
  onManageGroups: () => void;
}) => {
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

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this session?')) return;
    await deleteSession(sessionId);
    load();
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
                <p className="text-[13px] font-medium text-slate-800 truncate">{athlete.name}</p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Dumbbell className="w-3 h-3" />
                  {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? 's' : ''} planned` : 'No session planned'}
                </p>
              </div>
              {canEdit && session && (
                <span onClick={e => handleDelete(e, session.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
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
