// components/gym/gymApi.ts
// All Supabase reads/writes for the Gym module, kept in one place so the
// components stay focused on rendering. Row shapes from Postgres are
// snake_case; everything returned from here is mapped to the camelCase
// types in ./types.

import { supabase } from '@/lib/supabase';
import type {
  GymExerciseGroupType,
  GymExerciseGroup,
  GymExercise,
  GymExerciseMerge,
  GymExerciseMergeSuggestion,
  GymPlayerDefaultPrimary,
  GymSessionGroup,
  GymSession,
  GymSessionItem,
  GymSessionItemDraft,
  GymGroupSessionPlan,
  GymGroupPlanItem,
  GymGroupPlanConflict,
} from './types';

// ── Exercise group types (Anterior / Posterior / …) ─────────────────────────

export async function fetchExerciseGroupTypes(clubId: string): Promise<GymExerciseGroupType[]> {
  const { data, error } = await supabase
    .from('gym_exercise_group_types')
    .select('id, club_id, name')
    .eq('club_id', clubId)
    .order('name');
  if (error) throw error;
  return (data || []).map((r: any) => ({ id: r.id, clubId: r.club_id, name: r.name }));
}

export async function createExerciseGroupType(clubId: string, name: string): Promise<GymExerciseGroupType> {
  const { data, error } = await supabase
    .from('gym_exercise_group_types')
    .insert({ club_id: clubId, name: name.trim() })
    .select('id, club_id, name')
    .single();
  if (error) throw error;
  return { id: data.id, clubId: data.club_id, name: data.name };
}

// ── Exercise groups ─────────────────────────────────────────────────────────

export async function fetchExerciseGroups(clubId: string): Promise<GymExerciseGroup[]> {
  const { data, error } = await supabase
    .from('gym_exercise_groups')
    .select('id, club_id, name, type_id, gym_exercise_group_types(name)')
    .eq('club_id', clubId)
    .order('name');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    name: r.name,
    typeId: r.type_id,
    typeName: r.gym_exercise_group_types?.name,
  }));
}

export async function createExerciseGroup(clubId: string, name: string, typeId: string | null): Promise<GymExerciseGroup> {
  const { data, error } = await supabase
    .from('gym_exercise_groups')
    .insert({ club_id: clubId, name: name.trim(), type_id: typeId })
    .select('id, club_id, name, type_id')
    .single();
  if (error) throw error;
  return { id: data.id, clubId: data.club_id, name: data.name, typeId: data.type_id };
}

export async function updateExerciseGroup(id: string, name: string, typeId: string | null): Promise<void> {
  const { error } = await supabase
    .from('gym_exercise_groups')
    .update({ name: name.trim(), type_id: typeId })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteExerciseGroup(id: string): Promise<void> {
  const { error } = await supabase.from('gym_exercise_groups').delete().eq('id', id);
  if (error) throw error;
}

// ── Exercise bank ────────────────────────────────────────────────────────

const EXERCISE_SELECT =
  'id, club_id, name, exercise_group_id, created_by, created_at, status, archived, merged_into_id, ' +
  'gym_exercise_groups(name), creator:user_profiles!gym_exercises_created_by_fkey(full_name)';

function mapExercise(r: any): GymExercise {
  return {
    id: r.id,
    clubId: r.club_id,
    name: r.name,
    exerciseGroupId: r.exercise_group_id,
    exerciseGroupName: r.gym_exercise_groups?.name,
    createdBy: r.created_by,
    createdByName: r.creator?.full_name,
    createdAt: r.created_at,
    status: r.status,
    archived: r.archived,
    mergedIntoId: r.merged_into_id,
  };
}

/** Active exercise bank for a club — excludes anything merged away. Pending
 *  (not-yet-Admin-reviewed) exercises ARE included so they're immediately
 *  usable while they wait in the review queue. */
export async function fetchExercises(clubId: string): Promise<GymExercise[]> {
  const { data, error } = await supabase
    .from('gym_exercises')
    .select(EXERCISE_SELECT)
    .eq('club_id', clubId)
    .eq('archived', false)
    .order('name');
  if (error) throw error;
  return (data || []).map(mapExercise);
}

/** Exercises awaiting Admin review (new entries not yet approved). */
export async function fetchPendingExercises(clubId: string): Promise<GymExercise[]> {
  const { data, error } = await supabase
    .from('gym_exercises')
    .select(EXERCISE_SELECT)
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .eq('archived', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapExercise);
}

/** Type-ahead search used by the session editor's exercise picker. */
export function searchExercises(exercises: GymExercise[], query: string): GymExercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return exercises;
  return exercises.filter(e => e.name.toLowerCase().includes(q));
}

/** Every new exercise starts life as 'pending' — flagged for Admin review —
 *  but is usable immediately (non-blocking) so adding one mid-session isn't
 *  interrupted by an approval step. */
export async function createExercise(clubId: string, name: string, exerciseGroupId: string, createdBy: string): Promise<GymExercise> {
  const { data, error } = await supabase
    .from('gym_exercises')
    .insert({ club_id: clubId, name: name.trim(), exercise_group_id: exerciseGroupId, created_by: createdBy })
    .select(EXERCISE_SELECT)
    .single();
  if (error) throw error;
  return mapExercise(data);
}

/** Admin marks a pending exercise as reviewed/accepted as its own distinct entry. */
export async function approveExercise(exerciseId: string): Promise<void> {
  const { error } = await supabase.from('gym_exercises').update({ status: 'approved' }).eq('id', exerciseId);
  if (error) throw error;
}

/** Rename an exercise bank entry in place (its group assignment is unchanged). */
export async function updateExerciseName(exerciseId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('gym_exercises').update({ name: trimmed }).eq('id', exerciseId);
  if (error) throw error;
}

/**
 * Admin merges `mergedExerciseId` into `survivorExerciseId`: every session
 * item, swap-effective reference, and player default pointing at the merged
 * exercise is rewritten to the survivor; the merged exercise is archived
 * (kept for audit, hidden from pickers) rather than deleted. Done via a
 * `security definer` Postgres function so all the rewrites are atomic and
 * the Admin-only check happens server-side too — mirrors the existing
 * `supabase.rpc('invite_user_to_club', ...)` pattern in AthleteManager.tsx.
 */
export async function mergeExercises(mergedExerciseId: string, survivorExerciseId: string, mergedBy: string): Promise<void> {
  const { error } = await supabase.rpc('merge_gym_exercises', {
    p_merged_id: mergedExerciseId,
    p_survivor_id: survivorExerciseId,
    p_merged_by: mergedBy,
  });
  if (error) throw error;
}

/** Completed-merge audit trail, most recent first. */
export async function fetchExerciseMerges(clubId: string): Promise<GymExerciseMerge[]> {
  const { data, error } = await supabase
    .from('gym_exercise_merges')
    .select('id, club_id, merged_exercise_id, merged_exercise_name, survivor_exercise_id, merged_by, merged_at, survivor:gym_exercises!gym_exercise_merges_survivor_exercise_id_fkey(name)')
    .eq('club_id', clubId)
    .order('merged_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    mergedExerciseId: r.merged_exercise_id,
    mergedExerciseName: r.merged_exercise_name,
    survivorExerciseId: r.survivor_exercise_id,
    survivorExerciseName: r.survivor?.name,
    mergedBy: r.merged_by,
    mergedAt: r.merged_at,
  }));
}

// ── Exercise-bank cleanup: name-similarity merge suggestions ───────────────
// Pure client-side Dice-coefficient (bigram overlap) over lowercased names —
// no DB extension required, consistent with searchExercises() also filtering
// client-side. Only ever suggests pairs within the same exercise group,
// since a merge across groups would break per-group default-primary logic.

function bigrams(s: string): string[] {
  const clean = s.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return [clean];
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

/** Dice coefficient of two strings' bigram sets, 0 (no overlap) to 1 (identical). */
export function similarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const bag = new Map<string, number>();
  for (const g of B) bag.set(g, (bag.get(g) || 0) + 1);
  let matches = 0;
  for (const g of A) {
    const count = bag.get(g) || 0;
    if (count > 0) {
      matches++;
      bag.set(g, count - 1);
    }
  }
  return (2 * matches) / (A.length + B.length);
}

/** Candidate merge pairs (same exercise group only), sorted highest-similarity first. */
export function suggestMerges(exercises: GymExercise[], threshold = 0.6): GymExerciseMergeSuggestion[] {
  const suggestions: GymExerciseMergeSuggestion[] = [];
  for (let i = 0; i < exercises.length; i++) {
    for (let j = i + 1; j < exercises.length; j++) {
      const a = exercises[i];
      const b = exercises[j];
      if (a.exerciseGroupId !== b.exerciseGroupId) continue;
      const score = similarity(a.name, b.name);
      if (score >= threshold) suggestions.push({ exercise: a, candidate: b, score });
    }
  }
  return suggestions.sort((x, y) => y.score - x.score);
}

/** Best same-group match for one exercise among a list of candidates (e.g. approved exercises). */
export function bestMatch(exercise: GymExercise, candidates: GymExercise[], threshold = 0.6): GymExerciseMergeSuggestion | null {
  let best: GymExerciseMergeSuggestion | null = null;
  for (const c of candidates) {
    if (c.id === exercise.id || c.exerciseGroupId !== exercise.exerciseGroupId) continue;
    const score = similarity(exercise.name, c.name);
    if (score >= threshold && (!best || score > best.score)) best = { exercise, candidate: c, score };
  }
  return best;
}

// ── Exercise-bank cleanup: "keep both" duplicate dismissals ────────────────
// A pair of exercises an Admin has looked at in the possible-duplicates list
// and confirmed really are two different exercises, not a merge candidate.
// Stored in canonical (sorted-id) order so the pair matches regardless of
// which side suggestMerges() happens to list first.

/** Canonical key for an unordered exercise pair — also used to check a suggested pair against the dismissed set. */
export function duplicatePairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join('|');
}

/** Pair-keys an Admin has already reviewed and dismissed as "not duplicates" — filter suggestMerges()'s output against this. */
export async function fetchDismissedDuplicatePairs(clubId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('gym_exercise_duplicate_dismissals')
    .select('exercise_a_id, exercise_b_id')
    .eq('club_id', clubId);
  if (error) throw error;
  return new Set((data || []).map((r: any) => duplicatePairKey(r.exercise_a_id, r.exercise_b_id)));
}

/** Admin marks a suggested duplicate pair as "keep both — these are unique entities". */
export async function dismissDuplicatePair(clubId: string, exerciseAId: string, exerciseBId: string, dismissedBy: string): Promise<void> {
  const [a, b] = [exerciseAId, exerciseBId].sort();
  const { error } = await supabase
    .from('gym_exercise_duplicate_dismissals')
    .insert({ club_id: clubId, exercise_a_id: a, exercise_b_id: b, dismissed_by: dismissedBy });
  if (error) throw error;
}

// ── Player default primary exercise (per exercise group) ───────────────────

export async function fetchPlayerDefaults(athleteId: string): Promise<GymPlayerDefaultPrimary[]> {
  const { data, error } = await supabase
    .from('gym_player_default_primary')
    .select('id, club_id, athlete_id, exercise_group_id, exercise_id, updated_by, updated_at, gym_exercises(name)')
    .eq('athlete_id', athleteId);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    athleteId: r.athlete_id,
    exerciseGroupId: r.exercise_group_id,
    exerciseId: r.exercise_id,
    exerciseName: r.gym_exercises?.name,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }));
}

export async function setPlayerDefault(
  clubId: string,
  athleteId: string,
  exerciseGroupId: string,
  exerciseId: string,
  updatedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('gym_player_default_primary')
    .upsert(
      {
        club_id: clubId,
        athlete_id: athleteId,
        exercise_group_id: exerciseGroupId,
        exercise_id: exerciseId,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'athlete_id,exercise_group_id' }
    );
  if (error) throw error;
}

// ── Gym-only session groups ─────────────────────────────────────────────

export async function fetchSessionGroups(clubId: string): Promise<GymSessionGroup[]> {
  const { data, error } = await supabase
    .from('gym_session_groups')
    .select('id, club_id, name, created_by, created_at, gym_session_group_members(athlete_id)')
    .eq('club_id', clubId)
    .order('name');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at,
    memberAthleteIds: (r.gym_session_group_members || []).map((m: any) => m.athlete_id),
  }));
}

export async function createSessionGroup(
  clubId: string,
  name: string,
  memberAthleteIds: string[],
  createdBy: string
): Promise<GymSessionGroup> {
  const { data, error } = await supabase
    .from('gym_session_groups')
    .insert({ club_id: clubId, name: name.trim(), created_by: createdBy })
    .select('id, club_id, name, created_by, created_at')
    .single();
  if (error) throw error;

  if (memberAthleteIds.length > 0) {
    const { error: memErr } = await supabase
      .from('gym_session_group_members')
      .insert(memberAthleteIds.map(athleteId => ({ group_id: data.id, athlete_id: athleteId })));
    if (memErr) throw memErr;
  }

  return {
    id: data.id,
    clubId: data.club_id,
    name: data.name,
    createdBy: data.created_by,
    createdAt: data.created_at,
    memberAthleteIds,
  };
}

export async function setSessionGroupMembers(groupId: string, memberAthleteIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from('gym_session_group_members').delete().eq('group_id', groupId);
  if (delErr) throw delErr;
  if (memberAthleteIds.length > 0) {
    const { error: insErr } = await supabase
      .from('gym_session_group_members')
      .insert(memberAthleteIds.map(athleteId => ({ group_id: groupId, athlete_id: athleteId })));
    if (insErr) throw insErr;
  }
}

export async function deleteSessionGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('gym_session_groups').delete().eq('id', groupId);
  if (error) throw error;
}

// ── Sessions ─────────────────────────────────────────────────────────────

function mapSessionItem(r: any): GymSessionItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    sortOrder: r.sort_order,
    itemType: r.item_type,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise?.name,
    sets: r.sets,
    reps: r.reps,
    load: r.load,
    isPrimary: r.is_primary,
    side: r.side || 'both',
    effectiveExerciseId: r.effective_exercise_id,
    effectiveExerciseName: r.effective_exercise?.name,
    wasSwapped: r.was_swapped,
    noteText: r.note_text,
    planItemId: r.plan_item_id ?? null,
    createdBy: r.created_by,
    createdByName: r.creator?.full_name,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

const SESSION_ITEM_SELECT =
  'id, session_id, sort_order, item_type, exercise_id, sets, reps, load, is_primary, side, effective_exercise_id, was_swapped, note_text, plan_item_id, created_by, created_at, updated_by, updated_at, ' +
  'exercise:gym_exercises!gym_session_items_exercise_id_fkey(name), ' +
  'effective_exercise:gym_exercises!gym_session_items_effective_exercise_id_fkey(name), ' +
  'creator:user_profiles!gym_session_items_created_by_fkey(full_name)';

/** All sessions (+ items) for a club on a given date — used by the staff daily view. */
export async function fetchSessionsForDate(clubId: string, date: string): Promise<GymSession[]> {
  const { data, error } = await supabase
    .from('gym_sessions')
    .select(
      `id, club_id, athlete_id, date, source_group_id, created_by, created_at, updated_by, updated_at,
       gym_session_items(${SESSION_ITEM_SELECT})`
    )
    .eq('club_id', clubId)
    .eq('date', date);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    athleteId: r.athlete_id,
    date: r.date,
    sourceGroupId: r.source_group_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    items: (r.gym_session_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map(mapSessionItem),
  }));
}

/** All sessions (+ items) for a club across a set of dates — used by the weekly views. */
export async function fetchSessionsForDateRange(clubId: string, dates: string[]): Promise<GymSession[]> {
  if (dates.length === 0) return [];
  const { data, error } = await supabase
    .from('gym_sessions')
    .select(
      `id, club_id, athlete_id, date, source_group_id, created_by, created_at, updated_by, updated_at,
       gym_session_items(${SESSION_ITEM_SELECT})`
    )
    .eq('club_id', clubId)
    .in('date', dates);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    athleteId: r.athlete_id,
    date: r.date,
    sourceGroupId: r.source_group_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    items: (r.gym_session_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map(mapSessionItem),
  }));
}

/** A single athlete's sessions across a set of dates — used by the Player view. */
export async function fetchAthleteSessionsForDateRange(athleteId: string, dates: string[]): Promise<GymSession[]> {
  if (dates.length === 0) return [];
  const { data, error } = await supabase
    .from('gym_sessions')
    .select(
      `id, club_id, athlete_id, date, source_group_id, created_by, created_at, updated_by, updated_at,
       gym_session_items(${SESSION_ITEM_SELECT})`
    )
    .eq('athlete_id', athleteId)
    .in('date', dates);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    clubId: r.club_id,
    athleteId: r.athlete_id,
    date: r.date,
    sourceGroupId: r.source_group_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    items: (r.gym_session_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map(mapSessionItem),
  }));
}

/** Get-or-create the session row for one athlete on one date. */
export async function getOrCreateSession(
  clubId: string,
  athleteId: string,
  date: string,
  createdBy: string,
  sourceGroupId: string | null = null
): Promise<GymSession> {
  const { data: existing, error: findErr } = await supabase
    .from('gym_sessions')
    .select('id, club_id, athlete_id, date, source_group_id, created_by, created_at, updated_by, updated_at')
    .eq('athlete_id', athleteId)
    .eq('date', date)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    return {
      id: existing.id,
      clubId: existing.club_id,
      athleteId: existing.athlete_id,
      date: existing.date,
      sourceGroupId: existing.source_group_id,
      createdBy: existing.created_by,
      createdAt: existing.created_at,
      updatedBy: existing.updated_by,
      updatedAt: existing.updated_at,
    };
  }

  const { data, error } = await supabase
    .from('gym_sessions')
    .insert({ club_id: clubId, athlete_id: athleteId, date, created_by: createdBy, source_group_id: sourceGroupId })
    .select('id, club_id, athlete_id, date, source_group_id, created_by, created_at, updated_by, updated_at')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    clubId: data.club_id,
    athleteId: data.athlete_id,
    date: data.date,
    sourceGroupId: data.source_group_id,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  };
}

/** Assign a session to every member of a gym group — one independent session per athlete. */
export async function assignSessionToGroup(
  clubId: string,
  groupId: string,
  memberAthleteIds: string[],
  date: string,
  createdBy: string
): Promise<GymSession[]> {
  const sessions: GymSession[] = [];
  for (const athleteId of memberAthleteIds) {
    sessions.push(await getOrCreateSession(clubId, athleteId, date, createdBy, groupId));
  }
  return sessions;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('gym_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ── Primary/default exercise swap rule ──────────────────────────────────

export interface ResolvedPrimary {
  effectiveExerciseId: string;
  wasSwapped: boolean;
}

/**
 * If the item is marked Primary and the player has a *different* default
 * exercise set for that exercise's group, the effective exercise becomes the
 * player's default (was_swapped = true). Otherwise the chosen exercise is
 * used as-is. This is evaluated once, at save time — see the plan for why.
 */
export async function resolvePrimaryExercise(
  athleteId: string,
  chosenExerciseId: string,
  isPrimary: boolean,
  exerciseGroupId: string
): Promise<ResolvedPrimary> {
  if (!isPrimary) {
    return { effectiveExerciseId: chosenExerciseId, wasSwapped: false };
  }
  const { data, error } = await supabase
    .from('gym_player_default_primary')
    .select('exercise_id')
    .eq('athlete_id', athleteId)
    .eq('exercise_group_id', exerciseGroupId)
    .maybeSingle();
  if (error) throw error;

  if (data && data.exercise_id !== chosenExerciseId) {
    return { effectiveExerciseId: data.exercise_id, wasSwapped: true };
  }
  return { effectiveExerciseId: chosenExerciseId, wasSwapped: false };
}

// ── Session items (exercises + notes) ───────────────────────────────────

/**
 * Save (create or update) one session item. For exercise items this first
 * resolves the Primary swap rule above. `exerciseGroupId` is required only
 * for exercise items (used to look up the player's default).
 */
export async function saveSessionItem(
  sessionId: string,
  athleteId: string,
  draft: GymSessionItemDraft,
  exerciseGroupId: string | null,
  sortOrder: number,
  userId: string
): Promise<GymSessionItem> {
  let effectiveExerciseId: string | null = null;
  let wasSwapped = false;

  if (draft.itemType === 'exercise') {
    if (!draft.exerciseId || !exerciseGroupId) {
      throw new Error('An exercise must be selected before saving.');
    }
    const resolved = await resolvePrimaryExercise(athleteId, draft.exerciseId, draft.isPrimary, exerciseGroupId);
    effectiveExerciseId = resolved.effectiveExerciseId;
    wasSwapped = resolved.wasSwapped;
  }

  const payload: any = {
    session_id: sessionId,
    sort_order: sortOrder,
    item_type: draft.itemType,
    exercise_id: draft.itemType === 'exercise' ? draft.exerciseId : null,
    sets: draft.itemType === 'exercise' ? draft.sets : null,
    reps: draft.itemType === 'exercise' ? draft.reps : null,
    load: draft.itemType === 'exercise' ? draft.load : null,
    is_primary: draft.itemType === 'exercise' ? draft.isPrimary : false,
    side: draft.itemType === 'exercise' ? draft.side : 'both',
    effective_exercise_id: effectiveExerciseId,
    was_swapped: wasSwapped,
    note_text: draft.itemType === 'note' ? draft.noteText : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (draft.id) {
    const { data, error } = await supabase
      .from('gym_session_items')
      .update(payload)
      .eq('id', draft.id)
      .select(SESSION_ITEM_SELECT)
      .single();
    if (error) throw error;
    return mapSessionItem(data);
  }

  const { data, error } = await supabase
    .from('gym_session_items')
    .insert({ ...payload, created_by: userId })
    .select(SESSION_ITEM_SELECT)
    .single();
  if (error) throw error;
  return mapSessionItem(data);
}

export async function deleteSessionItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('gym_session_items').delete().eq('id', itemId);
  if (error) throw error;
}

/** Persist a new item order after a drag-reorder. */
export async function reorderSessionItems(items: { id: string; sortOrder: number }[]): Promise<void> {
  for (const item of items) {
    const { error } = await supabase.from('gym_session_items').update({ sort_order: item.sortOrder }).eq('id', item.id);
    if (error) throw error;
  }
}

export function itemToDraft(item: GymSessionItem): GymSessionItemDraft {
  return {
    itemType: item.itemType,
    exerciseId: item.exerciseId,
    sets: item.sets,
    reps: item.reps,
    load: item.load,
    isPrimary: item.isPrimary,
    side: item.side,
    noteText: item.noteText,
  };
}

/**
 * Copy a set of session items onto one or more destination athlete+dates.
 * Each destination's session is created if needed and the items are
 * appended after whatever's already there (never overwrites). Reuses
 * saveSessionItem so resolvePrimaryExercise() re-runs per destination
 * athlete — a copied Primary exercise resolves against *that* athlete's own
 * default, not the source athlete's, which is what we want.
 */
export interface CopySessionResult {
  athleteId: string;
  date: string;
  items: GymSessionItem[]; // newly created items at this destination — used to undo the copy
}

export async function copySessionItems(
  items: GymSessionItem[],
  destinations: { athleteId: string; date: string }[],
  exerciseGroupIdFor: (exerciseId: string) => string | null,
  clubId: string,
  userId: string
): Promise<CopySessionResult[]> {
  const results: CopySessionResult[] = [];
  for (const dest of destinations) {
    const session = await getOrCreateSession(clubId, dest.athleteId, dest.date, userId);
    const existing = await fetchAthleteSessionsForDateRange(dest.athleteId, [dest.date]);
    let sortOrder = existing[0]?.items?.length ?? 0;
    const created: GymSessionItem[] = [];
    for (const item of items) {
      const exerciseGroupId = item.itemType === 'exercise' && item.exerciseId ? exerciseGroupIdFor(item.exerciseId) : null;
      created.push(await saveSessionItem(session.id, dest.athleteId, itemToDraft(item), exerciseGroupId, sortOrder, userId));
      sortOrder++;
    }
    results.push({ athleteId: dest.athleteId, date: dest.date, items: created });
  }
  return results;
}

/**
 * Add one item to every member of a gym group's session for a date, in one
 * go — used by the group-session bulk editor. Each member's session is
 * created if needed and each item save is independent, so the swap rule
 * still resolves per-athlete.
 */
// ── Rehab filter (reuses RehabPlanner.tsx's own definition of "on rehab") ──
// An athlete is "on rehab" for a week if they have a rehab_plan_rows row
// under that week's rehab_plans row — exactly how RehabPlanner.tsx's
// loadWeekPlan() determines its own roster. weekCommencing must be the
// Monday of the week (same as WeekStrip.getWeekDates(date)[0]).
export async function fetchRehabAthleteIds(clubId: string, weekCommencing: string): Promise<Set<string>> {
  const { data: plan, error: planErr } = await supabase
    .from('rehab_plans')
    .select('id')
    .eq('club_id', clubId)
    .eq('week_commencing', weekCommencing)
    .maybeSingle();
  if (planErr) throw planErr;
  if (!plan) return new Set();
  const { data: rows, error: rowsErr } = await supabase.from('rehab_plan_rows').select('athlete_id').eq('plan_id', plan.id);
  if (rowsErr) throw rowsErr;
  return new Set((rows || []).map((r: any) => r.athlete_id));
}

export async function addItemToGroupSession(
  clubId: string,
  groupId: string,
  memberAthleteIds: string[],
  date: string,
  draft: GymSessionItemDraft,
  exerciseGroupId: string | null,
  userId: string
): Promise<GymSessionItem[]> {
  const saved: GymSessionItem[] = [];
  for (const athleteId of memberAthleteIds) {
    const session = await getOrCreateSession(clubId, athleteId, date, userId, groupId);
    const existing = await fetchAthleteSessionsForDateRange(athleteId, [date]);
    const sortOrder = existing[0]?.items?.length ?? 0;
    saved.push(await saveSessionItem(session.id, athleteId, draft, exerciseGroupId, sortOrder, userId));
  }
  return saved;
}

// ── Group session plans (UI 2 "All" mode) ───────────────────────────────
// A canonical, per-group-per-date exercise list, separate from each member's
// own gym_sessions/gym_session_items row. Editing it fans changes out to
// every member — see syncGroupPlanItemChange()/resolveGroupPlanConflict()
// below for exactly what auto-applies vs needs a manual decision.

function mapGroupPlanItem(r: any): GymGroupPlanItem {
  return {
    id: r.id,
    planId: r.plan_id,
    sortOrder: r.sort_order,
    itemType: r.item_type,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise?.name,
    sets: r.sets,
    reps: r.reps,
    load: r.load,
    isPrimary: r.is_primary,
    side: r.side || 'both',
    noteText: r.note_text,
    createdBy: r.created_by,
    createdByName: r.creator?.full_name,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

const GROUP_PLAN_ITEM_SELECT =
  'id, plan_id, sort_order, item_type, exercise_id, sets, reps, load, is_primary, side, note_text, created_by, created_at, updated_by, updated_at, ' +
  'exercise:gym_exercises!gym_group_plan_items_exercise_id_fkey(name), ' +
  'creator:user_profiles!gym_group_plan_items_created_by_fkey(full_name)';

export function groupPlanItemToDraft(item: GymGroupPlanItem): GymSessionItemDraft {
  return {
    itemType: item.itemType,
    exerciseId: item.exerciseId,
    exerciseName: item.exerciseName,
    sets: item.sets,
    reps: item.reps,
    load: item.load,
    isPrimary: item.isPrimary,
    side: item.side,
    noteText: item.noteText,
  };
}

/** Get-or-create the plan "container" row for one group on one date. */
export async function getOrCreateGroupPlan(clubId: string, groupId: string, date: string, createdBy: string): Promise<GymGroupSessionPlan> {
  const { data: existing, error: findErr } = await supabase
    .from('gym_group_session_plans')
    .select('id, club_id, group_id, date, created_by, created_at, updated_by, updated_at')
    .eq('group_id', groupId)
    .eq('date', date)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    return {
      id: existing.id,
      clubId: existing.club_id,
      groupId: existing.group_id,
      date: existing.date,
      createdBy: existing.created_by,
      createdAt: existing.created_at,
      updatedBy: existing.updated_by,
      updatedAt: existing.updated_at,
    };
  }
  const { data, error } = await supabase
    .from('gym_group_session_plans')
    .insert({ club_id: clubId, group_id: groupId, date, created_by: createdBy })
    .select('id, club_id, group_id, date, created_by, created_at, updated_by, updated_at')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    clubId: data.club_id,
    groupId: data.group_id,
    date: data.date,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  };
}

export async function fetchGroupPlanItems(planId: string): Promise<GymGroupPlanItem[]> {
  const { data, error } = await supabase
    .from('gym_group_plan_items')
    .select(GROUP_PLAN_ITEM_SELECT)
    .eq('plan_id', planId)
    .order('sort_order');
  if (error) throw error;
  return (data || []).map(mapGroupPlanItem);
}

/** Save (create or update) one group plan item. Pass `draft.id` as the plan item's own id to edit it. */
export async function saveGroupPlanItem(
  planId: string,
  draft: GymSessionItemDraft,
  sortOrder: number,
  userId: string
): Promise<GymGroupPlanItem> {
  const payload: any = {
    plan_id: planId,
    sort_order: sortOrder,
    item_type: draft.itemType,
    exercise_id: draft.itemType === 'exercise' ? draft.exerciseId : null,
    sets: draft.itemType === 'exercise' ? draft.sets : null,
    reps: draft.itemType === 'exercise' ? draft.reps : null,
    load: draft.itemType === 'exercise' ? draft.load : null,
    is_primary: draft.itemType === 'exercise' ? draft.isPrimary : false,
    side: draft.itemType === 'exercise' ? draft.side : 'both',
    note_text: draft.itemType === 'note' ? draft.noteText : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (draft.id) {
    const { data, error } = await supabase.from('gym_group_plan_items').update(payload).eq('id', draft.id).select(GROUP_PLAN_ITEM_SELECT).single();
    if (error) throw error;
    return mapGroupPlanItem(data);
  }
  const { data, error } = await supabase.from('gym_group_plan_items').insert({ ...payload, created_by: userId }).select(GROUP_PLAN_ITEM_SELECT).single();
  if (error) throw error;
  return mapGroupPlanItem(data);
}

export async function deleteGroupPlanItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('gym_group_plan_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function reorderGroupPlanItems(items: { id: string; sortOrder: number }[]): Promise<void> {
  for (const item of items) {
    const { error } = await supabase.from('gym_group_plan_items').update({ sort_order: item.sortOrder }).eq('id', item.id);
    if (error) throw error;
  }
}

/**
 * Called right after a plan item is added, edited, or deleted — pass `before`
 * as null for a brand-new item, `after` as null for a deletion. Immediately
 * applies the change to every member whose own item still matches the OLD
 * plan values (safe — they never touched it) and returns a conflict for
 * anyone who'd modified or removed their own copy, so the caller can show a
 * per-athlete accept-new/keep-current confirmation. An individual's own
 * additions (items with no plan_item_id at all) are never touched.
 */
export async function syncGroupPlanItemChange(
  clubId: string,
  groupId: string,
  memberAthleteIds: string[],
  date: string,
  planItemId: string,
  before: GymGroupPlanItem | null,
  after: GymGroupPlanItem | null,
  exerciseGroupIdFor: (exerciseId: string) => string | null,
  userId: string
): Promise<{ appliedCount: number; conflicts: GymGroupPlanConflict[] }> {
  const memberSessions = await fetchSessionsForDateRange(clubId, [date]);
  const conflicts: GymGroupPlanConflict[] = [];
  let appliedCount = 0;

  const sameAsPlan = (item: GymSessionItem, plan: GymGroupPlanItem) =>
    item.itemType === plan.itemType &&
    item.exerciseId === plan.exerciseId &&
    item.sets === plan.sets &&
    item.reps === plan.reps &&
    item.load === plan.load &&
    item.isPrimary === plan.isPrimary &&
    item.side === plan.side &&
    item.noteText === plan.noteText;

  for (const athleteId of memberAthleteIds) {
    const session = memberSessions.find(s => s.athleteId === athleteId);
    const memberItem = session?.items?.find(i => i.planItemId === planItemId) || null;

    if (!before) {
      // Brand-new plan item — nothing to conflict with, add it for everyone.
      if (!after) continue;
      const s = await getOrCreateSession(clubId, athleteId, date, userId, groupId);
      const sortOrder = session?.items?.length ?? 0;
      const eg = after.itemType === 'exercise' && after.exerciseId ? exerciseGroupIdFor(after.exerciseId) : null;
      const saved = await saveSessionItem(s.id, athleteId, groupPlanItemToDraft(after), eg, sortOrder, userId);
      const { error } = await supabase.from('gym_session_items').update({ plan_item_id: planItemId }).eq('id', saved.id);
      if (error) throw error;
      appliedCount++;
      continue;
    }

    if (!memberItem) {
      // The member already removed their own copy of this item.
      if (!after) continue; // plan deleted it too — nothing left to reconcile
      conflicts.push({
        athleteId,
        planItemId,
        groupId,
        date,
        kind: 'edit',
        memberItemId: null,
        memberSortOrder: null,
        currentDraft: null,
        newDraft: groupPlanItemToDraft(after),
        exerciseGroupId: after.itemType === 'exercise' && after.exerciseId ? exerciseGroupIdFor(after.exerciseId) : null,
      });
      continue;
    }

    const unmodified = sameAsPlan(memberItem, before);

    if (!after) {
      // Plan item deleted.
      if (unmodified) {
        await deleteSessionItem(memberItem.id);
        appliedCount++;
      } else {
        conflicts.push({
          athleteId,
          planItemId,
          groupId,
          date,
          kind: 'delete',
          memberItemId: memberItem.id,
          memberSortOrder: memberItem.sortOrder,
          currentDraft: itemToDraft(memberItem),
          newDraft: null,
          exerciseGroupId: null,
        });
      }
      continue;
    }

    // Plan item edited.
    if (unmodified) {
      const eg = after.itemType === 'exercise' && after.exerciseId ? exerciseGroupIdFor(after.exerciseId) : null;
      const saved = await saveSessionItem(memberItem.sessionId, athleteId, { ...groupPlanItemToDraft(after), id: memberItem.id }, eg, memberItem.sortOrder, userId);
      const { error } = await supabase.from('gym_session_items').update({ plan_item_id: planItemId }).eq('id', saved.id);
      if (error) throw error;
      appliedCount++;
    } else {
      conflicts.push({
        athleteId,
        planItemId,
        groupId,
        date,
        kind: 'edit',
        memberItemId: memberItem.id,
        memberSortOrder: memberItem.sortOrder,
        currentDraft: itemToDraft(memberItem),
        newDraft: groupPlanItemToDraft(after),
        exerciseGroupId: after.itemType === 'exercise' && after.exerciseId ? exerciseGroupIdFor(after.exerciseId) : null,
      });
    }
  }

  return { appliedCount, conflicts };
}

/**
 * All of a group's plan items across a set of dates, keyed by date — used
 * by UI 2's Calendar/Compare tabs in "All players" mode, which show only
 * the group's shared plan for each date, never any individual member's own
 * modifications or additions (those live on the members' own gym_sessions
 * rows, never fetched here).
 */
export async function fetchGroupPlansForDateRange(groupId: string, dates: string[]): Promise<Map<string, GymGroupPlanItem[]>> {
  const map = new Map<string, GymGroupPlanItem[]>();
  if (dates.length === 0) return map;
  const { data: plans, error: plansErr } = await supabase
    .from('gym_group_session_plans')
    .select('id, date')
    .eq('group_id', groupId)
    .in('date', dates);
  if (plansErr) throw plansErr;
  if (!plans || plans.length === 0) return map;

  const planIdToDate = new Map<string, string>();
  for (const p of plans) planIdToDate.set(p.id, p.date);

  const { data: itemRows, error: itemsErr } = await supabase
    .from('gym_group_plan_items')
    .select(GROUP_PLAN_ITEM_SELECT)
    .in('plan_id', Array.from(planIdToDate.keys()))
    .order('sort_order');
  if (itemsErr) throw itemsErr;

  for (const row of itemRows || []) {
    const item = mapGroupPlanItem(row);
    const date = planIdToDate.get(item.planId);
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(item);
  }
  return map;
}

export interface CopyGroupPlanResult {
  date: string;
  items: GymGroupPlanItem[]; // newly created plan items at this destination — used to undo the copy
  appliedCount: number;
  conflicts: GymGroupPlanConflict[];
}

/**
 * Copy a set of group-plan items onto one or more destination dates for the
 * same group (used by "All players" mode's Calendar copy/paste and
 * Compare's "Copy to this week"). Each destination's plan is created if
 * needed and items are appended after whatever's already there. Every
 * newly created plan item is then fanned out to every member via
 * syncGroupPlanItemChange with `before: null` — the same "brand-new item"
 * path GroupPlanEditor's own add-item flow uses — so it applies
 * automatically to anyone with no existing customization and raises a
 * conflict for anyone who's already added their own item in that same
 * "slot" (rare, since the plan item is new, but kept for consistency with
 * the rest of the group-plan API rather than assuming it can't happen).
 */
export async function copyGroupPlanItems(
  items: GymGroupPlanItem[],
  destinations: { date: string }[],
  clubId: string,
  groupId: string,
  memberAthleteIds: string[],
  exerciseGroupIdFor: (exerciseId: string) => string | null,
  userId: string
): Promise<CopyGroupPlanResult[]> {
  const results: CopyGroupPlanResult[] = [];
  for (const dest of destinations) {
    const plan = await getOrCreateGroupPlan(clubId, groupId, dest.date, userId);
    const existing = await fetchGroupPlanItems(plan.id);
    let sortOrder = existing.length;
    const created: GymGroupPlanItem[] = [];
    let appliedCount = 0;
    const conflicts: GymGroupPlanConflict[] = [];
    for (const item of items) {
      const saved = await saveGroupPlanItem(plan.id, groupPlanItemToDraft(item), sortOrder, userId);
      created.push(saved);
      sortOrder++;
      const result = await syncGroupPlanItemChange(clubId, groupId, memberAthleteIds, dest.date, saved.id, null, saved, exerciseGroupIdFor, userId);
      appliedCount += result.appliedCount;
      conflicts.push(...result.conflicts);
    }
    results.push({ date: dest.date, items: created, appliedCount, conflicts });
  }
  return results;
}

/**
 * Undo helper for a group-plan copy/paste: deletes the given plan items and
 * every member session item that was fanned out from them, on one date.
 * Best-effort by design (mirrors the rest of Undo in this module) — a
 * conflict a coach had already resolved before hitting Undo isn't reversed.
 */
export async function deleteGroupPlanItemsAndSynced(
  planItemIds: string[],
  clubId: string,
  groupId: string,
  memberAthleteIds: string[],
  date: string
): Promise<void> {
  const memberSessions = await fetchSessionsForDateRange(clubId, [date]);
  for (const planItemId of planItemIds) {
    for (const athleteId of memberAthleteIds) {
      const session = memberSessions.find(s => s.athleteId === athleteId);
      const item = session?.items?.find(i => i.planItemId === planItemId);
      if (item) await deleteSessionItem(item.id);
    }
    await deleteGroupPlanItem(planItemId);
  }
}

/** Apply one conflict's decision — `accept: true` takes the plan's new value, `false` leaves the member's own item exactly as it is. */
export async function resolveGroupPlanConflict(clubId: string, conflict: GymGroupPlanConflict, accept: boolean, userId: string): Promise<void> {
  if (!accept) return; // "keep current" — member's existing state (including "already removed") is left untouched
  if (!conflict.newDraft) {
    // The plan removed this item and the coach accepted that for a member who'd customized it.
    if (conflict.memberItemId) await deleteSessionItem(conflict.memberItemId);
    return;
  }
  const session = await getOrCreateSession(clubId, conflict.athleteId, conflict.date, userId, conflict.groupId);
  let sortOrder = conflict.memberSortOrder;
  if (sortOrder == null) {
    const existing = await fetchAthleteSessionsForDateRange(conflict.athleteId, [conflict.date]);
    sortOrder = existing[0]?.items?.length ?? 0;
  }
  const draft: GymSessionItemDraft = conflict.memberItemId ? { ...conflict.newDraft, id: conflict.memberItemId } : conflict.newDraft;
  const saved = await saveSessionItem(session.id, conflict.athleteId, draft, conflict.exerciseGroupId, sortOrder, userId);
  const { error } = await supabase.from('gym_session_items').update({ plan_item_id: conflict.planItemId }).eq('id', saved.id);
  if (error) throw error;
}

// ── Move session (UI 2 Day view) ────────────────────────────────────────
// Moves one athlete's whole session from one date to another. If the
// destination date already has a session, the moved items are appended
// after whatever's already there (never overwritten) — the caller is
// expected to have already confirmed that with the user, since gym_sessions
// has a unique(athlete_id, date) constraint so two sessions can't coexist.

export interface MoveSessionResult {
  athleteId: string;
  movedCount: number;
  destinationHadExisting: boolean;
  movedItemIds: string[];
  /** Every moved item's original data, for undo (re-creating them back at fromDate). */
  originalItems: GymSessionItem[];
}

export async function moveSessionItems(
  clubId: string,
  athleteId: string,
  fromDate: string,
  toDate: string,
  exerciseGroupIdFor: (exerciseId: string) => string | null,
  userId: string
): Promise<MoveSessionResult> {
  const [sourceSessions, destSessions] = await Promise.all([
    fetchAthleteSessionsForDateRange(athleteId, [fromDate]),
    fetchAthleteSessionsForDateRange(athleteId, [toDate]),
  ]);
  const source = sourceSessions[0];
  const dest = destSessions[0];
  const destinationHadExisting = !!(dest?.items && dest.items.length > 0);

  if (!source || !source.items || source.items.length === 0) {
    return { athleteId, movedCount: 0, destinationHadExisting, movedItemIds: [], originalItems: [] };
  }

  const destSession = await getOrCreateSession(clubId, athleteId, toDate, userId, source.sourceGroupId ?? null);
  let sortOrder = dest?.items?.length ?? 0;
  const movedItemIds: string[] = [];
  const originalItems = source.items;
  for (const item of source.items) {
    const eg = item.itemType === 'exercise' && item.exerciseId ? exerciseGroupIdFor(item.exerciseId) : null;
    const saved = await saveSessionItem(destSession.id, athleteId, itemToDraft(item), eg, sortOrder, userId);
    movedItemIds.push(saved.id);
    sortOrder++;
  }
  for (const item of originalItems) await deleteSessionItem(item.id);

  return { athleteId, movedCount: originalItems.length, destinationHadExisting, movedItemIds, originalItems };
}
