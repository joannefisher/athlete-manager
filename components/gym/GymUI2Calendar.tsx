// components/gym/GymUI2Calendar.tsx
// UI 2 Concept C — Calendar (month) tab. Shows a full month grid for the
// current scope (one athlete at a time), with every day's full session
// detail rendered directly in its cell — no click-through to a day view
// required to see what's planned. Each cell also has a "+" affordance that
// opens the full SessionEditor in a modal overlay, so an exercise can be
// added without ever leaving Calendar mode.

import React, { useEffect, useState, useCallback } from 'react';
import { Clipboard, ClipboardCheck, Copy, Edit2, Loader2, Plus, StickyNote, X } from 'lucide-react';
import type { GymAthlete as Athlete, GymConditioningExercise, GymExercise, GymExerciseGroupType, GymRunningExercise, GymSession, GymSessionGroup, GymSessionItem } from './types';
import { fetchAthleteSessionsForDateRange, copySessionItems, deleteSessionItem } from './gymApi';
import { todayIso } from './WeekStrip';
import { itemCompactLabel } from './itemDisplay';
import { SessionEditor } from './SessionEditor';
import { useGymUndo } from './GymUndoContext';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGridDates(monthAnchor: string): { iso: string; inMonth: boolean }[] {
  const anchor = new Date(monthAnchor + 'T00:00:00');
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return { iso: d.toISOString().split('T')[0], inMonth: d.getMonth() === month };
  });
}

export const GymUI2Calendar = ({
  athlete,
  athleteId,
  monthAnchor,
  clubId,
  userId,
  canEdit,
  exerciseGroupTypes,
  exercises,
  conditioningExercises,
  runningExercises,
  athletes,
  sessionGroups,
  onExercisesChanged,
  selectedDate,
  onSelectDate,
}: {
  athlete?: Athlete;
  athleteId: string;
  monthAnchor: string;
  clubId: string;
  userId: string;
  canEdit: boolean;
  exerciseGroupTypes: GymExerciseGroupType[];
  exercises: GymExercise[];
  conditioningExercises: GymConditioningExercise[];
  runningExercises: GymRunningExercise[];
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  onExercisesChanged: () => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) => {
  const { pushUndo } = useGymUndo();
  const [loading, setLoading] = useState(true);
  const [sessionsByDate, setSessionsByDate] = useState<Map<string, GymSession>>(new Map());
  const [addModalDate, setAddModalDate] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ date: string; items: GymSessionItem[] } | null>(null);
  const [pasting, setPasting] = useState<string | null>(null);

  const grid = monthGridDates(monthAnchor);
  const gridDates = grid.map(g => g.iso);
  const today = todayIso();
  const monthLabel = new Date(monthAnchor + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await fetchAthleteSessionsForDateRange(athleteId, gridDates);
      const map = new Map<string, GymSession>();
      for (const s of sessions) map.set(s.date, s);
      setSessionsByDate(map);
    } catch (err) {
      console.error('[GymUI2Calendar] failed to load month sessions', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, monthAnchor]);

  useEffect(() => { load(); }, [load]);

  const handleModalClosed = () => {
    setAddModalDate(null);
    load();
    onExercisesChanged();
  };

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupTypeId ?? null;

  const handleCopy = (e: React.MouseEvent, iso: string, items: GymSessionItem[]) => {
    e.stopPropagation();
    setClipboard({ date: iso, items });
  };

  const handlePaste = async (e: React.MouseEvent, iso: string) => {
    e.stopPropagation();
    if (!clipboard || clipboard.items.length === 0) return;
    setPasting(iso);
    try {
      const results = await copySessionItems(clipboard.items, [{ athleteId, date: iso }], exerciseGroupIdFor, clubId, userId);
      await load();
      const created = results.flatMap(r => r.items);
      pushUndo({
        label: `Undo paste onto ${new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        run: async () => {
          for (const item of created) await deleteSessionItem(item.id);
          await load();
        },
      });
    } catch (err: any) {
      console.error('[GymUI2Calendar] paste failed', err);
      window.alert(err?.message || 'Failed to paste this session.');
    } finally {
      setPasting(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <span className="text-[13px] font-semibold text-slate-700">{monthLabel}</span>
        <div className="flex items-center gap-2">
          {clipboard && (
            <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 flex items-center gap-1">
              <Clipboard className="w-3 h-3" /> Copied {new Date(clipboard.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — click{' '}
              <ClipboardCheck className="w-3 h-3 inline" /> on a day to paste
              <button onClick={() => setClipboard(null)} className="ml-1 text-blue-400 hover:text-blue-700">✕</button>
            </span>
          )}
          {loading && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAY_LABELS.map(l => (
          <div key={l} className="text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wide py-1.5">
            {l}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map(({ iso, inMonth }) => {
          const session = sessionsByDate.get(iso);
          const items = session?.items || [];
          const isToday = iso === today;
          const isSelected = iso === selectedDate;

          return (
            <div
              key={iso}
              onClick={() => onSelectDate(iso)}
              className={`min-h-[132px] border-b border-r border-slate-100 flex flex-col cursor-pointer transition-colors ${
                inMonth ? 'bg-white' : 'bg-slate-50/60'
              } ${isSelected ? 'ring-2 ring-inset ring-slate-900' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center justify-between px-1.5 pt-1.5">
                <span
                  className={`text-[11px] leading-none px-1.5 py-0.5 rounded-full font-semibold ${
                    isToday ? 'bg-blue-600 text-white' : inMonth ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  {new Date(iso + 'T00:00:00').getDate()}
                </span>
                {canEdit && (
                  <div className="flex items-center gap-0.5">
                    {items.length > 0 && (
                      <button
                        onClick={e => handleCopy(e, iso, items)}
                        title="Copy this day's session"
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {clipboard && (
                      <button
                        onClick={e => handlePaste(e, iso)}
                        disabled={pasting === iso}
                        title="Paste copied session here"
                        className="p-0.5 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700 disabled:opacity-40"
                      >
                        {pasting === iso ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setAddModalDate(iso);
                      }}
                      title={items.length > 0 ? 'Edit session' : 'Add exercise'}
                      className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                    >
                      {items.length > 0 ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1 space-y-0.5 max-h-[110px]">
                {items.map(item => (
                  <div
                    key={item.id}
                    className={`text-[10px] leading-tight px-1 py-0.5 rounded ${
                      item.itemType === 'note' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.itemType === 'note' ? (
                      <span className="flex items-start gap-0.5">
                        <StickyNote className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                        <span className="truncate">{item.noteText}</span>
                      </span>
                    ) : (
                      itemCompactLabel(item)
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {addModalDate && (
        <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={handleModalClosed}>
          <div
            className="bg-white rounded-xl w-full max-w-md md:max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h3 className="text-[14px] font-bold text-slate-900">
                {athlete?.name || 'Session'} —{' '}
                {new Date(addModalDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
              <button onClick={handleModalClosed} className="p-1 rounded hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <SessionEditor
              athlete={athlete}
              athleteId={athleteId}
              date={addModalDate}
              clubId={clubId}
              userId={userId}
              canEdit={canEdit}
              exerciseGroupTypes={exerciseGroupTypes}
              exercises={exercises}
              conditioningExercises={conditioningExercises}
              runningExercises={runningExercises}
              athletes={athletes}
              sessionGroups={sessionGroups}
              onExercisesChanged={() => {
                load();
                onExercisesChanged();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
