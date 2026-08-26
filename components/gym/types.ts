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

/** Flat conditioning-exercise list — its own list, separate from gym_exercises/exercise groups. */
export interface GymConditioningExercise {
  id: string;
  clubId: string;
  name: string;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
}

/** Flat running-exercise list — name + a distance in metres, looked up live (never snapshotted onto a session item). */
export interface GymRunningExercise {
  id: string;
  clubId: string;
  name: string;
  distanceMeters: number;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
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

/**
 * 'exercise' picks from the Gym exercise bank (gym_exercises) and carries
 * Sets/Reps/Load(kg)/Intensity/Tempo, an optional left/right split, and the
 * Primary-swap rule. 'conditioning' picks from its own separate flat list
 * (gym_conditioning_exercises — no exercise-bank/group tie) and carries only
 * Sets/Reps/Intensity — no Load(kg)/Tempo (UI-only restriction, not enforced
 * at the DB level), never offers "Mark as Primary", and never offers a
 * left/right split. 'running' picks from its own flat list
 * (gym_running_exercises) — its distance is looked up live from that list's
 * distance_meters, never entered/stored per-item. 'timer' is a labelled
 * duration, captured here as data only — see gymApi.ts's migration-0008
 * comment for what "captured as data only" means for the Player-facing
 * countdown that's ultimately meant to run off it.
 */
export type GymSessionItemType = 'exercise' | 'note' | 'running' | 'conditioning' | 'timer';

/** 'both' (default, one combined entry) or an independent 'left'/'right' half of a split exercise. Only ever set for 'exercise' items — every other type is always 'both'. */
export type GymSessionItemSide = 'both' | 'left' | 'right';

/** Distance unit for a 'running' item. */
export type GymDistanceUnit = 'm' | 'km';

export interface GymSessionItem {
  id: string;
  sessionId: string;
  sortOrder: number;
  itemType: GymSessionItemType;

  // exercise fields — exercise_id/effectiveExerciseId etc. are 'exercise'-only from round 16 on
  exerciseId: string | null;
  exerciseName?: string;
  /** Sets/Reps/Intensity are shared by 'exercise' and 'conditioning'; Load(kg)/Tempo (below) are 'exercise'-only. */
  sets: number | null;
  reps: number | null;
  /** Free-text %, e.g. "75" — displayed with a "%" suffix. Pre-round-14 sessions may still hold an old free-text value like "60kg" here; those display as-is. */
  load: string | null;
  /** Weight actually lifted, in kg — 'exercise' items only. */
  loadKg: number | null;
  /** Free text in "X-X-X-X" format, e.g. "3-1-1-0" — 'exercise' items only. Not validated/parsed — entered and displayed as typed. */
  tempo: string | null;
  isPrimary: boolean;
  side: GymSessionItemSide;
  effectiveExerciseId: string | null;
  effectiveExerciseName?: string;
  wasSwapped: boolean;

  // note fields
  noteText: string | null;

  // conditioning fields — its own flat list (gym_conditioning_exercises), no exercise-bank/group tie
  conditioningExerciseId: string | null;
  conditioningExerciseName?: string;

  // running fields — its own flat list (gym_running_exercises); distance is looked up live via
  // runningExerciseDistanceMeters (joined in), never entered/stored per-item. distanceValue/distanceUnit
  // below are superseded from round 16 on — left in place only so old rows aren't destroyed.
  runningExerciseId: string | null;
  runningExerciseName?: string;
  runningExerciseDistanceMeters?: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceValue: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceUnit: GymDistanceUnit | null;

  // timer fields
  timerLabel: string | null;
  /** Total duration in seconds — the Minutes/Seconds entry fields combine into this one value. */
  durationSeconds: number | null;

  // Set when this item was created/last synced from a group session plan
  // item (see GymGroupPlanItem below) — used to detect drift so a later plan
  // edit knows whether this item can be auto-updated or needs a manual
  // accept-new/keep-current decision. Null for anything the athlete (or a
  // coach editing them individually) added themselves.
  planItemId: string | null;

  // Grouping key shared by every member of the same Superset (2+ exercises
  // performed together, in a fixed order — see supersetDnd.ts). Null for an
  // item that isn't part of one. Not carried on GymSessionItemDraft — like
  // planItemId, it's set via a small follow-up update rather than through
  // the shared save-item payload, so that payload never has to change shape.
  supersetId: string | null;

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
  loadKg: number | null;
  tempo: string | null;
  isPrimary: boolean;
  side: GymSessionItemSide;
  noteText: string | null;
  conditioningExerciseId: string | null;
  conditioningExerciseName?: string;
  runningExerciseId: string | null;
  runningExerciseName?: string;
  runningExerciseDistanceMeters?: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceValue: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceUnit: GymDistanceUnit | null;
  timerLabel: string | null;
  durationSeconds: number | null;
}

// ── Group session plans ────────────────────────────────────────────────────
// A canonical, per-group-per-date exercise list — edited via UI 2's "All"
// mode — kept separate from each member's own GymSession/GymSessionItem
// rows. Editing a plan item fans the change out to every member; see
// gymApi.ts's syncGroupPlanItemChange()/resolveGroupPlanConflict().

export interface GymGroupSessionPlan {
  id: string;
  clubId: string;
  groupId: string;
  date: string;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface GymGroupPlanItem {
  id: string;
  planId: string;
  sortOrder: number;
  itemType: GymSessionItemType;

  exerciseId: string | null;
  exerciseName?: string;
  sets: number | null;
  reps: number | null;
  load: string | null;
  loadKg: number | null;
  tempo: string | null;
  isPrimary: boolean;
  side: GymSessionItemSide;

  noteText: string | null;

  conditioningExerciseId: string | null;
  conditioningExerciseName?: string;
  runningExerciseId: string | null;
  runningExerciseName?: string;
  runningExerciseDistanceMeters?: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceValue: number | null;
  /** @deprecated superseded by runningExerciseId/runningExerciseDistanceMeters — no longer written to. */
  distanceUnit: GymDistanceUnit | null;

  timerLabel: string | null;
  durationSeconds: number | null;

  /** Grouping key shared by every member of the same Superset — see GymSessionItem.supersetId above. */
  supersetId: string | null;

  createdBy: string | null;
  createdByName?: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** A member whose own item has drifted from a group plan item that just changed — needs a manual accept-new/keep-current decision. */
export interface GymGroupPlanConflict {
  athleteId: string;
  athleteName?: string;
  planItemId: string;
  groupId: string;
  date: string;
  kind: 'edit' | 'delete';
  memberItemId: string | null; // null = the member had already removed their own copy of this item
  memberSortOrder: number | null;
  currentDraft: GymSessionItemDraft | null; // the member's current values (null if they'd already removed it)
  newDraft: GymSessionItemDraft | null; // the plan's new values (null if the plan item was deleted)
  exerciseGroupId: string | null;
  /** The plan item's Superset grouping key at the time of this conflict, applied to the member's item if accepted. Null for a 'delete' conflict (unused). */
  supersetId: string | null;
}
