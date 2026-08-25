// components/gym/MoveSessionButton.tsx
// UI 2 Day-tab-only "Move session" action: pick a destination date (via the
// same mini-calendar popover used elsewhere), then move every item from the
// current date to that date for the current scope — one athlete, or every
// member of a group at once when "All" is selected. If the destination
// already has items, they're appended rather than overwritten, but only
// after a confirmation naming who already has something there.

import React, { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import type { GymAthlete as Athlete, GymExercise } from './types';
import { fetchSessionsForDateRange, moveSessionItems, deleteSessionItem, getOrCreateSession, saveSessionItem, itemToDraft, type MoveSessionResult } from './gymApi';
import { useGymUndo } from './GymUndoContext';
import { DatePickerPopover } from './DatePickerPopover';

const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export const MoveSessionButton = ({
  clubId,
  userId,
  date,
  isAllMode,
  currentAthleteId,
  groupMemberAthleteIds,
  athletes,
  exercises,
  onMoved,
}: {
  clubId: string;
  userId: string;
  date: string;
  isAllMode: boolean;
  currentAthleteId: string;
  groupMemberAthleteIds: string[];
  athletes: Athlete[];
  exercises: GymExercise[];
  onMoved: () => void;
}) => {
  const { pushUndo } = useGymUndo();
  const [showPicker, setShowPicker] = useState(false);
  const [moving, setMoving] = useState(false);

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupId ?? null;

  const doMove = async (toDate: string) => {
    setShowPicker(false);
    if (toDate === date) return;
    setMoving(true);
    try {
      const athleteIds = isAllMode ? groupMemberAthleteIds : [currentAthleteId];
      const destSessions = await fetchSessionsForDateRange(clubId, [toDate]);
      const conflicting = athleteIds.filter(id => (destSessions.find(s => s.athleteId === id)?.items?.length ?? 0) > 0);
      if (conflicting.length > 0) {
        const names = conflicting.map(id => athletes.find(a => a.id === id)?.name).filter(Boolean).join(', ');
        const already = conflicting.length === 1 ? 'already has a session' : 'already have sessions';
        const ok = window.confirm(`${names} ${already} on ${fmt(toDate)} — the moved exercises will be added alongside what's already there. Continue?`);
        if (!ok) {
          setMoving(false);
          return;
        }
      }

      const results: MoveSessionResult[] = [];
      for (const athleteId of athleteIds) {
        const r = await moveSessionItems(clubId, athleteId, date, toDate, exerciseGroupIdFor, userId);
        if (r.movedCount > 0) results.push(r);
      }

      if (results.length === 0) {
        window.alert("Nothing to move — there's no session here yet.");
      } else {
        pushUndo({
          label: `Move session${results.length > 1 ? 's' : ''} back to ${fmt(date)}`,
          run: async () => {
            for (const r of results) {
              for (const itemId of r.movedItemIds) await deleteSessionItem(itemId);
              const src = await getOrCreateSession(clubId, r.athleteId, date, userId);
              let sortOrder = 0;
              for (const orig of r.originalItems) {
                await saveSessionItem(src.id, r.athleteId, itemToDraft(orig), orig.exerciseId ? exerciseGroupIdFor(orig.exerciseId) : null, sortOrder, userId);
                sortOrder++;
              }
            }
            onMoved();
          },
        });
        onMoved();
      }
    } catch (err: any) {
      console.error('[MoveSessionButton] move failed', err);
      window.alert(err?.message || 'Failed to move this session.');
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowPicker(v => !v)}
        disabled={moving}
        className="h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-slate-200 text-[11.5px] font-medium text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40"
      >
        {moving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
        {isAllMode ? 'Move group session' : 'Move session'}
      </button>
      {showPicker && <DatePickerPopover value={date} onChange={doMove} onClose={() => setShowPicker(false)} align="right" />}
    </div>
  );
};
