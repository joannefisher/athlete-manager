// components/gym/itemDisplay.ts
// Shared formatting helpers for rendering a session item's real content
// (exercise name, sets/reps/load, split side, note text) compactly — used
// by StaffDailyView's per-player row and StaffWeeklyView's per-day cell so
// both show what's actually planned instead of a bare item count.

import type { GymSessionItem, GymSessionItemSide, GymSessionItemType } from './types';

// Shape shared by GymSessionItem (an athlete's own item) and GymGroupPlanItem
// (a group plan's item, no effectiveExerciseName/wasSwapped fields of its
// own) — lets these formatters serve both UI 2's Calendar/Compare tabs
// (per-athlete) and the "All players" group-plan equivalents without
// duplicating this logic.
interface ItemLike {
  itemType: GymSessionItemType;
  noteText: string | null;
  exerciseName?: string;
  effectiveExerciseName?: string;
  side: GymSessionItemSide;
  sets: number | null;
  reps: number | null;
  load: string | null;
}

export const sideLabel = (side: string): string => (side === 'left' ? 'Left' : side === 'right' ? 'Right' : '');

/** "4 sets × 8 reps × @50kg" — same format SessionEditor uses for its own rows. */
export function itemMetaText(item: Pick<GymSessionItem, 'sets' | 'reps' | 'load'>): string {
  return (
    [item.sets ? `${item.sets} sets` : null, item.reps ? `${item.reps} reps` : null, item.load ? `@ ${item.load}` : null]
      .filter(Boolean)
      .join(' × ') || 'No sets/reps/intensity set'
  );
}

export function itemDisplayName(item: ItemLike): string {
  if (item.itemType !== 'exercise') return item.noteText || 'Note';
  return item.effectiveExerciseName || item.exerciseName || 'Exercise';
}

/** One tight line for the week grid, e.g. "Front Squat (L) 4×5 @90kg". */
export function itemCompactLabel(item: ItemLike): string {
  if (item.itemType !== 'exercise') return item.noteText || 'Note';
  const name = itemDisplayName(item);
  const sideTag = item.side !== 'both' ? ` (${item.side === 'left' ? 'L' : 'R'})` : '';
  const setsReps = item.sets && item.reps ? `${item.sets}×${item.reps}` : item.sets ? `${item.sets} sets` : item.reps ? `${item.reps} reps` : '';
  const load = item.load ? `@${item.load}` : '';
  const meta = [setsReps, load].filter(Boolean).join(' ');
  return meta ? `${name}${sideTag} ${meta}` : `${name}${sideTag}`;
}
