// components/gym/itemDisplay.ts
// Shared formatting helpers for rendering a session item's real content
// (exercise name, sets/reps/load, split side, note text) compactly — used
// by StaffDailyView's per-player row and StaffWeeklyView's per-day cell so
// both show what's actually planned instead of a bare item count.

import type { GymSessionItem } from './types';

export const sideLabel = (side: string): string => (side === 'left' ? 'Left' : side === 'right' ? 'Right' : '');

/** "4 sets × 8 reps × @50kg" — same format SessionEditor uses for its own rows. */
export function itemMetaText(item: Pick<GymSessionItem, 'sets' | 'reps' | 'load'>): string {
  return (
    [item.sets ? `${item.sets} sets` : null, item.reps ? `${item.reps} reps` : null, item.load ? `@ ${item.load}` : null]
      .filter(Boolean)
      .join(' × ') || 'No sets/reps/load set'
  );
}

export function itemDisplayName(item: GymSessionItem): string {
  if (item.itemType !== 'exercise') return item.noteText || 'Note';
  return item.effectiveExerciseName || item.exerciseName || 'Exercise';
}

/** One tight line for the week grid, e.g. "Front Squat (L) 4×5 @90kg". */
export function itemCompactLabel(item: GymSessionItem): string {
  if (item.itemType !== 'exercise') return item.noteText || 'Note';
  const name = itemDisplayName(item);
  const sideTag = item.side !== 'both' ? ` (${item.side === 'left' ? 'L' : 'R'})` : '';
  const setsReps = item.sets && item.reps ? `${item.sets}×${item.reps}` : item.sets ? `${item.sets} sets` : item.reps ? `${item.reps} reps` : '';
  const load = item.load ? `@${item.load}` : '';
  const meta = [setsReps, load].filter(Boolean).join(' ');
  return meta ? `${name}${sideTag} ${meta}` : `${name}${sideTag}`;
}
