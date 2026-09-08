// components/gym/quickSessionShared.ts
// Small shared constants used by both QuickSessionPlanner.tsx and
// QuickItemRow.tsx — split out to avoid a circular import between them.

import { Activity, Clock, Dumbbell, Layers, StickyNote, Timer as TimerIcon } from 'lucide-react';
import type { GymSessionItemDraft, GymSessionItemType } from './types';

export const TYPE_TABS: { type: GymSessionItemType; label: string; Icon: any }[] = [
  { type: 'exercise', label: 'Exercise', Icon: Dumbbell },
  { type: 'conditioning', label: 'Conditioning', Icon: Activity },
  { type: 'running', label: 'Running', Icon: Clock },
  { type: 'timer', label: 'Timer', Icon: TimerIcon },
  { type: 'note', label: 'Note', Icon: StickyNote },
  { type: 'section', label: 'Section', Icon: Layers },
];

export const TYPE_ICON: Record<GymSessionItemType, any> = Object.fromEntries(TYPE_TABS.map(t => [t.type, t.Icon])) as any;

export const emptyDraft: GymSessionItemDraft = {
  itemType: 'exercise',
  exerciseId: null,
  sets: null,
  reps: null,
  load: null,
  loadKg: null,
  tempo: null,
  isPrimary: false,
  side: 'both',
  noteText: null,
  sectionName: null,
  conditioningExerciseId: null,
  runningExerciseId: null,
  distanceValue: null,
  distanceUnit: null,
  timerLabel: null,
  durationSeconds: null,
};
