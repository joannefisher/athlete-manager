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

export type GymBodyRegion = 'upper' | 'lower';
export type GymUpperPushPull = 'push' | 'pull';
export type GymUpperPlane = 'vertical' | 'horizontal';
export type GymLowerPosition = 'anterior' | 'posterior' | 'other';
export type GymLaterality = 'unilateral' | 'bilateral';

/**
 * Round 17: replaces the old two-level "Exercise Group Type" (simple tag) ->
 * "Exercise Group" (named, e.g. "Squat") hierarchy entirely. An Exercise
 * Group Type is now defined purely by this fixed attribute combination —
 * Upper Body (+ Push/Pull, + Vertical/Horizontal) or Lower Body (+
 * Anterior/Posterior/Other), plus an independent Unilateral/Bilateral
 * toggle that applies no matter which body region was picked. The unique
 * combination of these fields IS the type — see gymApi.findOrCreateExerciseGroupType,
 * which looks up-or-creates a row for a given combination rather than ever
 * creating a duplicate. This is also what the player Primary-default
 * mechanism is keyed on now (see GymPlayerDefaultPrimary below).
 */
export interface GymExerciseGroupType {
  id: string;
  clubId: string;
  bodyRegion: GymBodyRegion;
  upperPushPull: GymUpperPushPull | null; // set iff bodyRegion === 'upper'
  upperPlane: GymUpperPlane | null; // set iff bodyRegion === 'upper'
  lowerPosition: GymLowerPosition | null; // set iff bodyRegion === 'lower'
  laterality: GymLaterality;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
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
  // Nullable from round 17 on: a legacy exercise the auto-map migration
  // couldn't confidently place shows up with this null, surfaced in the
  // Exercises admin screen's "Needs review" list until an Admin assigns one.
  exerciseGroupTypeId: string | null;
  exerciseGroupTypeLabel?: string; // convenience, computed from the joined type's attributes for display
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
  exerciseGroupTypeId: string;
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

/**
 * Player session-runner lifecycle (migration 0015). 'planned' is the
 * default/original state (matches every pre-existing session — nothing
 * migrates existing rows out of it). Transitions only ever happen through
 * the four security-definer RPCs (player_start_session/pause/resume/
 * complete_session in gymApi.ts) — never a raw update — since only those
 * verify the caller owns the session via linked_athlete_id.
 */
export type GymSessionStatus = 'planned' | 'in_progress' | 'paused' | 'completed';

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

  // Player session-runner fields (migration 0015).
  status: GymSessionStatus;
  /** Resume pointer — the session_item this player was on when they paused. Null once completed/never started, or if that item was deleted since (see currentItemId comment on PlayerSessionRunner — a null/dangling value there means "restart from step 1"). */
  currentItemId: string | null;
  currentSetNumber: number | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  /** Present when fetched via gymApi.fetchSessionWithResults — one row per (session_item_id, set_number) already recorded for this session. */
  results?: GymSessionItemResult[];
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
 * countdown that's ultimately meant to run off it. 'section' (round 17) is a
 * simple named divider within the item list — just a heading, carrying only
 * sectionName; it has no interaction with Supersets or Split left/right (per
 * Joanne's answer, both stay unavailable for a section).
 */
export type GymSessionItemType = 'exercise' | 'note' | 'running' | 'conditioning' | 'timer' | 'section';

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

  // section fields — a simple named divider, no other data (round 17)
  sectionName: string | null;

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
  sectionName: string | null;
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
  sectionName: string | null;

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
  exerciseGroupTypeId: string | null;
  /** The plan item's Superset grouping key at the time of this conflict, applied to the member's item if accepted. Null for a 'delete' conflict (unused). */
  supersetId: string | null;
}

// ── Player session runner (migration 0015) ─────────────────────────────────

/**
 * One recorded set for a session item — what the player actually did,
 * separate from the item's prescribed sets/reps/load. One row per
 * (sessionItemId, setNumber); saved via gymApi.saveSetResult (upsert).
 * 'running'/'timer' items (no real per-set breakdown) always use setNumber 1.
 */
export interface GymSessionItemResult {
  id: string;
  sessionId: string;
  sessionItemId: string;
  setNumber: number;
  /** 'exercise' + 'conditioning' — reps actually done this set. */
  actualReps: number | null;
  /** 'exercise' only — load actually used this set, in kg. */
  actualLoadKg: number | null;
  /** 'conditioning' only — the new Time field, in seconds, actually done this set. */
  actualDurationSeconds: number | null;
  /** 'running' only — one editable actual-distance value for the whole item (setNumber 1), in metres. */
  actualDistanceMeters: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * One screen of the player runner, produced by runnerSteps.ts's
 * buildStepSequence from a session's items. Non-superset exercise/
 * conditioning items expand to one RunnerStep per prescribed set;
 * everything else (running/timer/note/section, and any non-set-bearing
 * type) is a single step with setNumber null. Superset members are
 * interleaved round-by-round — see buildStepSequence's own comment for the
 * drop-out-on-exhaustion rule when members have unequal set counts.
 */
export interface RunnerStep {
  /** Stable resume pointer — `${item.id}:${setNumber ?? ''}`. Not a DB id. */
  key: string;
  item: GymSessionItem;
  /** Null for types with no per-set breakdown (running/timer/note/section). */
  setNumber: number | null;
  isFirstOfItem: boolean;
  isLastOfItem: boolean;
  /** Non-null iff item.supersetId is set — drives the "Superset A · 1 of 2" badge. */
  superset: {
    supersetId: string;
    /** 1-based position of this item within its superset group (stable across rounds — not the round number). */
    position: number;
    size: number;
  } | null;
}
