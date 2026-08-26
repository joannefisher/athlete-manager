// components/gym/itemDisplay.ts
// Shared formatting helpers for rendering a session item's real content
// (name, Sets/Reps/Load(kg)/Intensity/Tempo, distance, duration, split side,
// note text) compactly — used by StaffDailyView's per-player row and
// StaffWeeklyView's per-day cell so both show what's actually planned
// instead of a bare item count, and by SessionItemChip/CopySessionModal/
// PlayerGymView for the same purpose elsewhere.

import type { GymSessionItemSide, GymSessionItemType } from './types';

// Shape shared by GymSessionItem (an athlete's own item), GymGroupPlanItem (a
// group plan's item, no effectiveExerciseName/wasSwapped of its own), and
// GymSessionItemDraft (a not-yet-saved item) — lets these formatters serve
// every item-bearing view in the module without duplicating this logic.
interface ItemLike {
  itemType: GymSessionItemType;
  noteText: string | null;
  exerciseName?: string;
  effectiveExerciseName?: string;
  conditioningExerciseName?: string;
  runningExerciseName?: string;
  runningExerciseDistanceMeters?: number | null;
  side: GymSessionItemSide;
  sets: number | null;
  reps: number | null;
  load: string | null;
  loadKg: number | null;
  tempo: string | null;
  timerLabel: string | null;
  durationSeconds: number | null;
}

export const sideLabel = (side: string): string => (side === 'left' ? 'Left' : side === 'right' ? 'Right' : '');

/** "75" -> "75%"; anything non-numeric (including old free-text values like "60kg"/"bodyweight" saved before Intensity became %-only) is shown as-is. */
export function formatIntensityPct(load: string | null): string | null {
  if (!load) return null;
  const trimmed = load.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}%` : trimmed;
}

/** Total seconds -> "2:05". */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null) return '';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "4 sets × 8 reps × 60kg × @75% × tempo 3-1-1-0" for Exercise (Conditioning drops the kg/tempo parts); distance for Running; duration for Timer. Same format SessionEditor uses for its own rows. */
export function itemMetaText(item: ItemLike): string {
  if (item.itemType === 'note') return '';
  if (item.itemType === 'running') {
    return item.runningExerciseDistanceMeters != null ? `${item.runningExerciseDistanceMeters}m` : 'No distance set';
  }
  if (item.itemType === 'timer') {
    return item.durationSeconds != null ? formatDuration(item.durationSeconds) : 'No duration set';
  }
  if (item.itemType === 'conditioning') {
    // No Load(kg)/Tempo for Conditioning — removed round 16.
    const parts = [
      item.sets ? `${item.sets} sets` : null,
      item.reps ? `${item.reps} reps` : null,
      item.load ? `@ ${formatIntensityPct(item.load)}` : null,
    ].filter(Boolean);
    return parts.join(' × ') || 'No sets/reps set';
  }
  // exercise
  const parts = [
    item.sets ? `${item.sets} sets` : null,
    item.reps ? `${item.reps} reps` : null,
    item.loadKg != null ? `${item.loadKg}kg` : null,
    item.load ? `@ ${formatIntensityPct(item.load)}` : null,
    item.tempo ? `tempo ${item.tempo}` : null,
  ].filter(Boolean);
  return parts.join(' × ') || 'No sets/reps/load set';
}

export function itemDisplayName(item: ItemLike): string {
  if (item.itemType === 'note') return item.noteText || 'Note';
  if (item.itemType === 'running') return item.runningExerciseName || 'Running';
  if (item.itemType === 'timer') return item.timerLabel || 'Timer';
  if (item.itemType === 'conditioning') return item.conditioningExerciseName || 'Conditioning';
  // exercise
  return item.effectiveExerciseName || item.exerciseName || 'Exercise';
}

/** One tight line for the week grid, e.g. "Front Squat (L) 4×5 @75%/60kg". */
export function itemCompactLabel(item: ItemLike): string {
  if (item.itemType === 'note') return item.noteText || 'Note';
  const name = itemDisplayName(item);
  if (item.itemType === 'running' || item.itemType === 'timer') {
    const meta = itemMetaText(item);
    return meta ? `${name} ${meta}` : name;
  }
  if (item.itemType === 'conditioning') {
    const meta = itemMetaText(item);
    return meta && meta !== 'No sets/reps set' ? `${name} ${meta}` : name;
  }
  // exercise
  const sideTag = item.side !== 'both' ? ` (${item.side === 'left' ? 'L' : 'R'})` : '';
  const setsReps = item.sets && item.reps ? `${item.sets}×${item.reps}` : item.sets ? `${item.sets} sets` : item.reps ? `${item.reps} reps` : '';
  const loadBits = [item.loadKg != null ? `${item.loadKg}kg` : null, item.load ? formatIntensityPct(item.load) : null].filter(Boolean).join('/');
  const meta = [setsReps, loadBits ? `@${loadBits}` : ''].filter(Boolean).join(' ');
  return meta ? `${name}${sideTag} ${meta}` : `${name}${sideTag}`;
}
