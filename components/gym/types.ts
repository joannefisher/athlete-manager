// components/gym/types.ts
// Shared types for the Gym module. Kept separate from AthleteManager.tsx's
// own interfaces (Athlete, TeamPosition, etc.) — imported alongside them
// where needed.

export interface GymExerciseGroupType {
  id: string;
  clubId: string;
  name: string; // e.g. "Anterior", "Posterior" — editable list, seeded by migration
}

export interface GymExerciseGroup {
  id: string;
  clubId: string;
  name: string; // e.g. "Squat", "Hinge", "Push", "Pull"
  typeId: string | null;
  typeName?: string; // convenience, joined in for display
}

export interface GymExercise {
  id: string;
  clubId: string;
  name: string;
  exerciseGroupId: string;
  exerciseGroupName?: string; // convenience, joined in for display
  createdBy: string | null;
  createdAt: string;
}

export interface GymPlayerDefaultPrimary {
  id: string;
  clubId: string;
  athleteId: string;
  exerciseGroupId: string;
  exerciseId: string;
  exerciseName?: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface GymSessionGroup {
  id: string;
  clubId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  memberAthleteIds: string[];
}

export interface GymSession {
  id: string;
  clubId: string;
  athleteId: string;
  date: string; // yyyy-mm-dd
  sourceGroupId: string | null;
  createdBy: string | null;
  createdByName?: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  items?: GymSessionItem[];
}

export type GymSessionItemType = 'exercise' | 'note';

export interface GymSessionItem {
  id: string;
  sessionId: string;
  sortOrder: number;
  itemType: GymSessionItemType;

  // exercise fields
  exerciseId: string | null;
  exerciseName?: string;
  sets: number | null;
  reps: number | null;
  load: string | null;
  isPrimary: boolean;
  effectiveExerciseId: string | null;
  effectiveExerciseName?: string;
  wasSwapped: boolean;

  // note fields
  noteText: string | null;

  createdBy: string | null;
  createdByName?: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

// Draft shape used while building/editing a session item in the UI, before
// it's been resolved/saved.
export interface GymSessionItemDraft {
  id?: string; // present when editing an existing item
  itemType: GymSessionItemType;
  exerciseId: string | null;
  exerciseName?: string; // used for free-typed "add new" exercises not yet created
  sets: number | null;
  reps: number | null;
  load: string | null;
  isPrimary: boolean;
  noteText: string | null;
}
