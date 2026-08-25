// components/gym/types.ts
// Shared types for the Gym module. Gym is its own top-level app (a sibling
// of TrainingPlanner/RehabPlanner/MainSchedule under the AthleteManager.tsx
// app selector), so it deliberately does NOT import Athlete/etc. from those
// other apps' internal (unexported) types — it fetches and shapes its own
// minimal athlete data instead.

/** Minimal athlete shape Gym needs for rosters — fetched independently by Gym.tsx. */
export interface GymAthlete {
  id: string;
  name: string;
  avatar?: string | null;
  // Position numbers from the shared `athlete_positions`/`team_structure`
  // tables (same model TrainingPlanner.tsx uses) — resolved to names/groups
  // via GymTeamPosition, used by GroupPicker's position filter.
  positionNumbers?: number[];
}

/** Mirrors TrainingPlanner.tsx's `team_structure` shape, fetched by Gym.tsx for the group-member position filter. */
export interface GymTeamPosition {
  id: string;
  number: number;
  name: string;
  group: string; // e.g. "Forward" / "Back"
}

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

export type GymExerciseStatus = 'pending' | 'approved';

export interface GymExercise {
  id: string;
  clubId: string;
  name: string;
  exerciseGroupId: string;
  exerciseGroupName?: string; // convenience, joined in for display
  createdBy: string | null;
  createdByName?: string; // convenience, joined in for display (Admin review queue)
  createdAt: string;
  // Exercise-bank cleanup: every new exercise starts 'pending' so it's
  // flagged to Admins, but stays usable immediately (non-blocking). Merging
  // one exercise into another archives the merged-away row instead of
  // deleting it, so history stays intact.
  status: GymExerciseStatus;
  archived: boolean;
  mergedIntoId: string | null;
}

/** Audit trail row for a completed exercise merge (see gymApi.mergeExercises). */
export interface GymExerciseMerge {
  id: string;
  clubId: string;
  mergedExerciseId: string;
  mergedExerciseName: string;
  survivorExerciseId: string;
  survivorExerciseName?: string;
  mergedBy: string | null;
  mergedAt: string;
}

/** A same-group candidate pair suggested by client-side name similarity. */
export interface GymExerciseMergeSuggestion {
  exercise: GymExercise;
  candidate: GymExercise;
  score: number; // 0..1, higher = more similar
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

/** 'both' (default, one combined entry) or an independent 'left'/'right' half of a split exercise. */
export type GymSessionItemSide = 'both' | 'left' | 'right';

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
  side: GymSessionItemSide;
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
  side: GymSessionItemSide;
  noteText: string | null;
}
