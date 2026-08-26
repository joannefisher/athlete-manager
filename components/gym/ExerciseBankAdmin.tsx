// components/gym/ExerciseBankAdmin.tsx
// Admin management for the Gym exercise bank: the hierarchical "Exercise
// Group Types" (round 17 — replaces the old type-tag + named-group
// hierarchy entirely, see GroupTypePicker.tsx) and the exercise bank itself
// (individual exercises, each tied to one Exercise Group Type). Rendered as
// collapsible cards inside Gym's own "Exercises" tab. Read-only (no
// Add/Edit/Delete controls) when canEdit is false.

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Edit2, Plus } from 'lucide-react';
import {
  fetchExerciseGroupTypes,
  findOrCreateExerciseGroupType,
  fetchExercises,
  fetchExercisesNeedingReview,
  createExercise,
  updateExerciseName,
  updateExerciseGroupType,
} from './gymApi';
import type { GymExercise, GymExerciseGroupType } from './types';
import type { Role } from '../AthleteManager';
import { ExerciseReviewPanel } from './ExerciseReviewPanel';
import { GroupTypePicker, emptyGroupTypeAttrs, isGroupTypeAttrsComplete, groupTypeLabel, groupTypeToAttrs, type GroupTypeAttrs } from './GroupTypePicker';

export const ExerciseBankAdmin = ({ clubId, currentUserId, canEdit, role }: { clubId: string; currentUserId: string; canEdit: boolean; role: Role }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [types, setTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [needsReview, setNeedsReview] = useState<GymExercise[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [newTypeAttrs, setNewTypeAttrs] = useState<GroupTypeAttrs>(emptyGroupTypeAttrs);
  const [savingType, setSavingType] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseTypeAttrs, setNewExerciseTypeAttrs] = useState<GroupTypeAttrs>(emptyGroupTypeAttrs);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editExerciseName, setEditExerciseName] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewAttrs, setReviewAttrs] = useState<GroupTypeAttrs>(emptyGroupTypeAttrs);

  const load = useCallback(async () => {
    const [t, e, r] = await Promise.all([fetchExerciseGroupTypes(clubId), fetchExercises(clubId), fetchExercisesNeedingReview(clubId)]);
    setTypes(t);
    setExercises(e);
    setNeedsReview(r);
    setLoaded(true);
  }, [clubId]);

  useEffect(() => {
    if (expanded && !loaded) load();
  }, [expanded, loaded, load]);

  // "Needs review" is important enough to always load up front, even before
  // any card is expanded, so the amber banner below is visible immediately.
  useEffect(() => { load(); }, [load]);

  const toggle = (key: string) => setExpanded(expanded === key ? null : key);

  const handleAddType = async () => {
    if (!isGroupTypeAttrsComplete(newTypeAttrs)) return;
    setSavingType(true);
    try {
      await findOrCreateExerciseGroupType(clubId, newTypeAttrs, currentUserId);
      setNewTypeAttrs(emptyGroupTypeAttrs);
      load();
    } finally {
      setSavingType(false);
    }
  };

  const handleAddExercise = async () => {
    if (!newExerciseName.trim() || !isGroupTypeAttrsComplete(newExerciseTypeAttrs)) return;
    const type = await findOrCreateExerciseGroupType(clubId, newExerciseTypeAttrs, currentUserId);
    await createExercise(clubId, newExerciseName.trim(), type.id, currentUserId);
    setNewExerciseName('');
    setNewExerciseTypeAttrs(emptyGroupTypeAttrs);
    setShowAddExercise(false);
    load();
  };

  const startReview = (ex: GymExercise) => {
    setReviewingId(ex.id);
    setReviewAttrs(emptyGroupTypeAttrs);
  };

  const handleAssignReview = async (exerciseId: string) => {
    if (!isGroupTypeAttrsComplete(reviewAttrs)) return;
    const type = await findOrCreateExerciseGroupType(clubId, reviewAttrs, currentUserId);
    await updateExerciseGroupType(exerciseId, type.id);
    setReviewingId(null);
    load();
  };

  const startEditExerciseType = (ex: GymExercise, current: GymExerciseGroupType | undefined) => {
    setReviewingId(ex.id);
    setReviewAttrs(current ? groupTypeToAttrs(current) : emptyGroupTypeAttrs);
  };

  return (
    <>
      {needsReview.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden mb-3">
          <div className="p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-sm text-amber-800">Needs review — {needsReview.length} exercise{needsReview.length !== 1 ? 's' : ''}</h3>
              <p className="text-xs text-amber-700">
                These exercises came from the old exercise groups and couldn't be confidently mapped onto the new Exercise Group Type hierarchy. Assign one below.
              </p>
            </div>
          </div>
          <div className="border-t border-amber-200 divide-y divide-amber-200">
            {needsReview.map(ex => (
              <div key={ex.id} className="p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">{ex.name}</span>
                  {canEdit && reviewingId !== ex.id && (
                    <button onClick={() => startReview(ex)} className="text-xs px-2 py-1 bg-amber-600 text-white rounded font-medium">Assign type</button>
                  )}
                </div>
                {canEdit && reviewingId === ex.id && (
                  <div className="space-y-2 bg-white rounded-lg border border-amber-200 p-2.5">
                    <GroupTypePicker value={reviewAttrs} onChange={setReviewAttrs} />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAssignReview(ex.id)}
                        disabled={!isGroupTypeAttrsComplete(reviewAttrs)}
                        className="flex-1 px-2 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button onClick={() => setReviewingId(null)} className="flex-1 px-2 py-1.5 bg-slate-100 rounded text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exercise Group Types */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => toggle('types')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div>
            <h3 className="font-semibold text-sm text-left">Exercise Group Types</h3>
            <p className="text-xs text-slate-500">{types.length} types</p>
          </div>
          {expanded === 'types' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'types' && (
          <div className="border-t">
            {types.map(t => (
              <div key={t.id} className="p-3 border-b last:border-b-0 text-sm">{groupTypeLabel(t)}</div>
            ))}
            {types.length === 0 && <div className="p-3 text-sm text-slate-400">No types yet.</div>}
            {canEdit && (
              <div className="p-3 border-t space-y-2">
                <GroupTypePicker value={newTypeAttrs} onChange={setNewTypeAttrs} />
                <button
                  onClick={handleAddType}
                  disabled={!isGroupTypeAttrsComplete(newTypeAttrs) || savingType}
                  className="w-full px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-medium disabled:opacity-40"
                >
                  Add type
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exercise bank */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mt-3">
        <button onClick={() => toggle('exercises')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div>
            <h3 className="font-semibold text-sm text-left">Exercise Bank</h3>
            <p className="text-xs text-slate-500">{exercises.length} exercises</p>
          </div>
          {expanded === 'exercises' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'exercises' && (
          <div className="border-t">
            {exercises.map(ex => {
              const currentType = types.find(t => t.id === ex.exerciseGroupTypeId);
              return (
                <div key={ex.id} className="p-3 border-b last:border-b-0">
                  {editingExerciseId === ex.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editExerciseName}
                        onChange={e => setEditExerciseName(e.target.value)}
                        className="flex-1 px-2 py-1 text-sm border rounded"
                        autoFocus
                      />
                      <button
                        onClick={async () => {
                          if (!editExerciseName.trim()) return;
                          await updateExerciseName(ex.id, editExerciseName.trim());
                          setEditingExerciseId(null);
                          load();
                        }}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingExerciseId(null)} className="px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                    </div>
                  ) : reviewingId === ex.id ? (
                    <div className="space-y-2 bg-slate-50 rounded-lg border border-slate-200 p-2.5">
                      <p className="text-sm font-medium">{ex.name}</p>
                      <GroupTypePicker value={reviewAttrs} onChange={setReviewAttrs} />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAssignReview(ex.id)}
                          disabled={!isGroupTypeAttrsComplete(reviewAttrs)}
                          className="flex-1 px-2 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button onClick={() => setReviewingId(null)} className="flex-1 px-2 py-1.5 bg-slate-100 rounded text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <span className="text-sm">
                        {ex.name} <span className="text-xs text-slate-400">({ex.exerciseGroupTypeLabel || 'no type set'})</span>
                        {ex.status === 'pending' && (
                          <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Pending review</span>
                        )}
                      </span>
                      {canEdit && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setEditingExerciseId(ex.id); setEditExerciseName(ex.name); }}
                            className="p-1 hover:bg-slate-100 rounded"
                            title="Rename"
                          >
                            <Edit2 className="w-4 h-4 text-slate-500" />
                          </button>
                          <button
                            onClick={() => startEditExerciseType(ex, currentType)}
                            className="text-[11px] px-2 py-1 hover:bg-slate-100 rounded text-slate-500"
                          >
                            Change type
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {canEdit && (showAddExercise ? (
              <div className="p-3 border-t space-y-2">
                <input value={newExerciseName} onChange={e => setNewExerciseName(e.target.value)} placeholder="Exercise name" className="w-full px-2 py-1.5 text-sm border rounded" />
                <GroupTypePicker value={newExerciseTypeAttrs} onChange={setNewExerciseTypeAttrs} />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddExercise}
                    disabled={!newExerciseName.trim() || !isGroupTypeAttrsComplete(newExerciseTypeAttrs)}
                    className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button onClick={() => { setShowAddExercise(false); setNewExerciseName(''); setNewExerciseTypeAttrs(emptyGroupTypeAttrs); }} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="p-3 border-t">
                <button onClick={() => setShowAddExercise(true)} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium">
                  <Plus className="w-4 h-4 inline mr-1" />Add Exercise
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {role === 'Admin' && <ExerciseReviewPanel clubId={clubId} currentUserId={currentUserId} onChanged={load} />}
    </>
  );
};
