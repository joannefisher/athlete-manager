// components/gym/GymUI2Compare.tsx
// UI 2 Concept C — Compare tab. Two sub-modes:
//  1. "Same weekday, past weeks" — one player, the same weekday compared
//     across the last few weeks (e.g. compare this Monday's session against
//     the last 3 Mondays), with a "Copy to this week" action per column.
//  2. "Players on a date" — one date, multiple players side by side, so a
//     coach can compare what different players are doing on the same day.

import React, { useEffect, useState, useCallback } from 'react';
import { Check, ChevronDown, Copy, Loader2, StickyNote, Users } from 'lucide-react';
import type { GymAthlete as Athlete, GymExercise, GymSession, GymSessionGroup } from './types';
import { fetchAthleteSessionsForDateRange, fetchSessionsForDateRange, copySessionItems, deleteSessionItem } from './gymApi';
import { useGymUndo } from './GymUndoContext';
import { itemCompactLabel } from './itemDisplay';
import { DatePickerPopover } from './DatePickerPopover';

type CompareSubMode = 'weekday' | 'players';

const WEEKS_BACK = 4;

const shiftDate = (d: string, days: number) => {
  const dd = new Date(d + 'T00:00:00');
  dd.setDate(dd.getDate() + days);
  return dd.toISOString().split('T')[0];
};
const fmtColHeader = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const SessionColumn = ({
  title,
  subtitle,
  session,
  emptyLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  session: GymSession | undefined;
  emptyLabel: string;
  action?: React.ReactNode;
}) => {
  const items = session?.items || [];
  return (
    <div className="flex-1 min-w-[190px] border border-slate-200 rounded-lg overflow-hidden bg-white">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-slate-800 truncate">{title}</div>
          {subtitle && <div className="text-[10.5px] text-slate-400">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="p-2 space-y-1 max-h-[420px] overflow-y-auto">
        {items.length === 0 && <div className="text-[11.5px] text-slate-400 italic px-1 py-2">{emptyLabel}</div>}
        {items.map(item => (
          <div
            key={item.id}
            className={`text-[11.5px] leading-snug px-2 py-1 rounded ${
              item.itemType === 'note' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {item.itemType === 'note' ? (
              <span className="flex items-start gap-1">
                <StickyNote className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{item.noteText}</span>
              </span>
            ) : (
              itemCompactLabel(item)
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const GymUI2Compare = ({
  clubId,
  userId,
  canEdit,
  athletes,
  exercises,
  sessionGroups,
  scopeAthleteId,
  scopeAthlete,
  anchorDate,
}: {
  clubId: string;
  userId: string;
  canEdit: boolean;
  athletes: Athlete[];
  exercises: GymExercise[];
  sessionGroups: GymSessionGroup[];
  scopeAthleteId: string;
  scopeAthlete?: Athlete;
  anchorDate: string;
}) => {
  const { pushUndo } = useGymUndo();
  const [subMode, setSubMode] = useState<CompareSubMode>('weekday');

  // ---- Sub-mode 1: same weekday across past weeks ----
  const [weekdaySessions, setWeekdaySessions] = useState<GymSession[]>([]);
  const [loadingWeekday, setLoadingWeekday] = useState(true);
  // WEEKS_BACK columns total, most recent (rightmost) = anchorDate itself.
  const columns = Array.from({ length: WEEKS_BACK }, (_, i) => shiftDate(anchorDate, -7 * (WEEKS_BACK - 1 - i)));

  const loadWeekday = useCallback(async () => {
    setLoadingWeekday(true);
    try {
      const sessions = await fetchAthleteSessionsForDateRange(scopeAthleteId, columns);
      setWeekdaySessions(sessions);
    } catch (err) {
      console.error('[GymUI2Compare] failed to load weekday comparison', err);
    } finally {
      setLoadingWeekday(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeAthleteId, anchorDate]);

  useEffect(() => {
    if (subMode === 'weekday') loadWeekday();
  }, [subMode, loadWeekday]);

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupId ?? null;

  const handleCopyToThisWeek = async (sourceSession: GymSession | undefined) => {
    if (!sourceSession || !sourceSession.items || sourceSession.items.length === 0) return;
    try {
      const results = await copySessionItems(
        sourceSession.items,
        [{ athleteId: scopeAthleteId, date: anchorDate }],
        exerciseGroupIdFor,
        clubId,
        userId
      );
      await loadWeekday();
      pushUndo({
        label: `Undo copy to ${new Date(anchorDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        run: async () => {
          for (const r of results) for (const item of r.items) await deleteSessionItem(item.id);
        },
      });
    } catch (err) {
      console.error('[GymUI2Compare] copy to this week failed', err);
      window.alert('Could not copy that session — please try again.');
    }
  };

  // ---- Sub-mode 2: multiple players, one date ----
  const [compareDate, setCompareDate] = useState(anchorDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set(scopeAthleteId ? [scopeAthleteId] : []));
  const [playerSessions, setPlayerSessions] = useState<GymSession[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  const togglePlayer = (id: string) => {
    setSelectedPlayerIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (subMode !== 'players' || selectedPlayerIds.size === 0) {
      setPlayerSessions([]);
      return;
    }
    let cancelled = false;
    setLoadingPlayers(true);
    fetchSessionsForDateRange(clubId, [compareDate])
      .then(sessions => { if (!cancelled) setPlayerSessions(sessions); })
      .catch(err => console.error('[GymUI2Compare] failed to load players-on-date comparison', err))
      .finally(() => { if (!cancelled) setLoadingPlayers(false); });
    return () => { cancelled = true; };
  }, [subMode, clubId, compareDate, selectedPlayerIds.size]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium">
          <button
            onClick={() => setSubMode('weekday')}
            className={`px-3 py-1.5 rounded flex items-center gap-1.5 ${subMode === 'weekday' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            Same weekday, past weeks
          </button>
          <button
            onClick={() => setSubMode('players')}
            className={`px-3 py-1.5 rounded flex items-center gap-1.5 ${subMode === 'players' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            <Users className="w-3.5 h-3.5" /> Players on a date
          </button>
        </div>
        {subMode === 'weekday' && loadingWeekday && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
      </div>

      {subMode === 'weekday' ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {columns.map((date, i) => {
            const session = weekdaySessions.find(s => s.date === date);
            const isCurrent = date === anchorDate;
            return (
              <SessionColumn
                key={date}
                title={fmtColHeader(date)}
                subtitle={isCurrent ? 'This week' : `${WEEKS_BACK - 1 - i} week${WEEKS_BACK - 1 - i !== 1 ? 's' : ''} ago`}
                session={session}
                emptyLabel="No session"
                action={
                  canEdit && !isCurrent && session?.items && session.items.length > 0 ? (
                    <button
                      onClick={() => handleCopyToThisWeek(session)}
                      title="Copy to this week"
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className="h-8 px-3 rounded-md border border-slate-200 text-[12.5px] font-medium text-slate-700 bg-white hover:bg-slate-50 flex items-center gap-1.5"
              >
                {new Date(compareDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
              {showDatePicker && (
                <DatePickerPopover value={compareDate} onChange={setCompareDate} onClose={() => setShowDatePicker(false)} />
              )}
            </div>
            {loadingPlayers && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
          </div>

          <div>
            <div className="text-[11px] font-medium text-slate-500 mb-1.5">Players ({selectedPlayerIds.size} selected)</div>
            <div className="flex flex-wrap gap-1.5">
              {athletes.map(a => {
                const active = selectedPlayerIds.has(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => togglePlayer(a.id)}
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    {active && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}
                    {a.name}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedPlayerIds.size === 0 ? (
            <div className="text-[12.5px] text-slate-400 italic px-1 py-4 text-center">Select one or more players to compare.</div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {Array.from(selectedPlayerIds).map(athleteId => {
                const athlete = athletes.find(a => a.id === athleteId);
                const session = playerSessions.find(s => s.athleteId === athleteId);
                return (
                  <SessionColumn
                    key={athleteId}
                    title={athlete?.name || 'Player'}
                    session={session}
                    emptyLabel="No session planned"
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
