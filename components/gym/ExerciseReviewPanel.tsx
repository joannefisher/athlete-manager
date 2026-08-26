// components/gym/ExerciseReviewPanel.tsx
// Admin-only exercise-bank cleanup queue: every newly-added exercise is
// flagged here for review (still usable immediately elsewhere, this isn't a
// blocking gate), with a same-group similarity suggestion for merging it
// into an existing entry instead of "Approve as new". Below that, a general
// scan for likely duplicates already sitting in the approved bank. Merging
// rewrites history via gymApi.mergeExercises (the merge_gym_exercises RPC)
// so past sessions/defaults stay consistent — see that function's comment.

import React, { useEffect, useState, useCallback } from 'react';
import { Check, ChevronDown, ChevronUp, GitMerge, ShieldAlert, Users2 } from 'lucide-react';
import {
  fetchExercises,
  approveExercise,
  mergeExercises,
  suggestMerges,
  bestMatch,
  fetchDismissedDuplicatePairs,
  dismissDuplicatePair,
  duplicatePairKey,
} from './gymApi';
import type { GymExercise } from './types';

export const ExerciseReviewPanel = ({ clubId, currentUserId, onChanged }: { clubId: string; currentUserId: string; onChanged: () => void }) => {
  const [expanded, setExpanded] = useState(false);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualPick, setManualPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [exs, dismissed] = await Promise.all([fetchExercises(clubId), fetchDismissedDuplicatePairs(clubId)]);
    setExercises(exs);
    setDismissedPairs(dismissed);
    setLoaded(true);
  }, [clubId]);

  useEffect(() => {
    if (expanded && !loaded) load();
  }, [expanded, loaded, load]);

  const pending = exercises.filter(e => e.status === 'pending');
  const approved = exercises.filter(e => e.status === 'approved');
  // Already-reviewed pairs (merged away, or explicitly "keep both") shouldn't
  // keep reappearing — a merge already removes itself since one side is
  // archived out of `approved`; dismissedPairs covers the "keep both" case.
  const duplicates = suggestMerges(approved).filter(d => !dismissedPairs.has(duplicatePairKey(d.exercise.id, d.candidate.id)));

  const refresh = async () => {
    await load();
    onChanged();
  };

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approveExercise(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleMerge = async (mergedId: string, survivorId: string) => {
    if (!survivorId) return;
    if (!window.confirm('Merge this exercise? Every past session and player default that uses it will be repointed to the exercise you keep.')) return;
    setBusyId(mergedId);
    try {
      await mergeExercises(mergedId, survivorId, currentUserId);
      await refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to merge.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (exerciseAId: string, exerciseBId: string) => {
    setBusyId(exerciseAId);
    try {
      await dismissDuplicatePair(clubId, exerciseAId, exerciseBId, currentUserId);
      await refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mt-3">
      <button onClick={() => setExpanded(v => !v)} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
        <div>
          <h3 className="font-semibold text-sm text-left flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" /> Exercise Review
          </h3>
          <p className="text-xs text-slate-500">
            {loaded ? `${pending.length} new entr${pending.length !== 1 ? 'ies' : 'y'}, ${duplicates.length} possible duplicate${duplicates.length !== 1 ? 's' : ''}` : 'New entries + possible duplicate merges'}
          </p>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      {expanded && (
        <div className="border-t">
          <div className="p-3 border-b">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">New entries awaiting review</p>
            {pending.length === 0 && <p className="text-sm text-slate-400">Nothing new.</p>}
            <div className="space-y-2">
              {pending.map(ex => {
                const suggestion = bestMatch(ex, approved);
                const sameGroupApproved = approved.filter(a => a.exerciseGroupTypeId === ex.exerciseGroupTypeId);
                const pick = manualPick[ex.id] ?? suggestion?.candidate.id ?? '';
                return (
                  <div key={ex.id} className="border border-slate-200 rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{ex.name} <span className="text-xs text-slate-400">({ex.exerciseGroupTypeLabel || 'no type set'})</span></p>
                        <p className="text-[11px] text-slate-400">added by {ex.createdByName || 'someone'}</p>
                      </div>
                      <button
                        onClick={() => handleApprove(ex.id)}
                        disabled={busyId === ex.id}
                        className="px-2.5 py-1 bg-green-100 text-green-700 rounded text-xs font-medium flex items-center gap-1 disabled:opacity-40 flex-shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve as new
                      </button>
                    </div>
                    {sameGroupApproved.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <select
                          value={pick}
                          onChange={e => setManualPick(m => ({ ...m, [ex.id]: e.target.value }))}
                          className="flex-1 px-2 py-1 text-xs border rounded"
                        >
                          <option value="">Merge into…</option>
                          {sameGroupApproved.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}{suggestion?.candidate.id === a.id ? ` (${Math.round(suggestion.score * 100)}% match)` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleMerge(ex.id, pick)}
                          disabled={!pick || busyId === ex.id}
                          className="px-2.5 py-1 bg-slate-800 text-white rounded text-xs font-medium flex items-center gap-1 disabled:opacity-40 flex-shrink-0"
                        >
                          <GitMerge className="w-3.5 h-3.5" /> Merge
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Possible duplicates in the bank</p>
            {duplicates.length === 0 && <p className="text-sm text-slate-400">No likely duplicates found.</p>}
            <div className="space-y-2">
              {duplicates.map(({ exercise, candidate, score }) => (
                <div key={`${exercise.id}-${candidate.id}`} className="border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <p className="text-sm min-w-0 truncate">
                    <span className="font-medium">{exercise.name}</span> <span className="text-slate-400">≈</span> <span className="font-medium">{candidate.name}</span>
                    <span className="text-[11px] text-slate-400 ml-1">({Math.round(score * 100)}% match, {exercise.exerciseGroupTypeLabel || 'no type set'})</span>
                  </p>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => handleMerge(candidate.id, exercise.id)} disabled={busyId !== null} className="px-2 py-1 text-xs border rounded hover:bg-slate-50 disabled:opacity-40">
                      Keep "{exercise.name}"
                    </button>
                    <button onClick={() => handleMerge(exercise.id, candidate.id)} disabled={busyId !== null} className="px-2 py-1 text-xs border rounded hover:bg-slate-50 disabled:opacity-40">
                      Keep "{candidate.name}"
                    </button>
                    <button
                      onClick={() => handleDismiss(exercise.id, candidate.id)}
                      disabled={busyId !== null}
                      title="Not a duplicate — keep both as separate exercises"
                      className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-slate-50 disabled:opacity-40 text-slate-500"
                    >
                      <Users2 className="w-3 h-3" /> Keep both
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
