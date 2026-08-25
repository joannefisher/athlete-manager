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
    effectiveExerciseId: r.effective_exercise_id,
    effectiveExerciseName: r.effective_exercise?.name,
    wasSwapped: r.was_swapped,
    noteText: r.note_text,
    createdBy: r.created_by,
    createdByName: r.creator?.full_name,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

const SESSION_ITEM_SELECT =
  'id, session_id, sort_order, item_type, exercise_id, sets, reps, load, is_primary, effective_exercise_id, was_swapped, note_text, created_by, created_at, updated_by, updated_at, ' +
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

function itemToDraft(item: GymSessionItem): GymSessionItemDraft {
  return {
    itemType: item.itemType,
    exerciseId: item.exerciseId,
    sets: item.sets,
    reps: item.reps,
    load: item.load,
    isPrimary: item.isPrimary,
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
export async function copySessionItems(
  items: GymSessionItem[],
  destinations: { athleteId: string; date: string }[],
  exerciseGroupIdFor: (exerciseId: string) => string | null,
  clubId: string,
  userId: string
): Promise<void> {
  for (const dest of destinations) {
    const session = await getOrCreateSession(clubId, dest.athleteId, dest.date, userId);
    const existing = await fetchAthleteSessionsForDateRange(dest.athleteId, [dest.date]);
    let sortOrder = existing[0]?.items?.length ?? 0;
    for (const item of items) {
      const exerciseGroupId = item.itemType === 'exercise' && item.exerciseId ? exerciseGroupIdFor(item.exerciseId) : null;
      await saveSessionItem(session.id, dest.athleteId, itemToDraft(item), exerciseGroupId, sortOrder, userId);
      sortOrder++;
    }
  }
}

/**
 * Add one item to every member of a gym group's session for a date, in one
 * go — used by the group-session bulk editor. Each member's session is
 * created if needed and each item save is independent, so the swap rule
 * still resolves per-athlete.
 */
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
