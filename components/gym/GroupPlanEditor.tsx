// components/gym/GroupPlanEditor.tsx
// UI 2's "All" mode: one shared, editable "group session plan" for every
// member of a gym group on one date (Day tab only). Adding/editing/deleting
// an exercise here immediately fans the change out to every member's own
// session — see gymApi.ts's syncGroupPlanItemChange() for exactly what
// auto-applies (nobody had touched that exercise) vs what needs a manual
// accept-new/keep-current decision (a member had already modified or
// removed their own copy of it) via the confirmation modal below.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  AlertTriangle, Check, Edit2, GripVertical, Link2, Loader2, Plus, StickyNote, Trash2, Users, X,
} from 'lucide-react';
import type { GymAthlete as Athlete, GymConditioningExercise, GymExercise, GymExerciseGroupType, GymGroupPlanConflict, GymGroupPlanItem, GymRunningExercise, GymSessionGroup, GymSessionItemDraft } from './types';
import {
  getOrCreateGroupPlan,
  fetchGroupPlanItems,
  saveGroupPlanItem,
  deleteGroupPlanItem,
  reorderGroupPlanItems,
  syncGroupPlanItemChange,
  resolveGroupPlanConflict,
  createExercise,
  searchExercises,
  createConditioningExercise,
  searchConditioningExercises,
  createRunningExercise,
  searchRunningExercises,
  findOrCreateExerciseGroupType,
  groupPlanItemToDraft,
  fetchFrequentSectionNames,
} from './gymApi';
import { applySupersetDrop, groupBySuperset, zoneForOffset, type DropZone } from './supersetDnd';
import { itemDisplayName, itemMetaText } from './itemDisplay';
import { useGymUndo } from './GymUndoContext';
import { GroupTypePicker, emptyGroupTypeAttrs, isGroupTypeAttrsComplete, type GroupTypeAttrs } from './GroupTypePicker';

const emptyDraft: GymSessionItemDraft = {
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

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const draftLabel = (draft: GymSessionItemDraft | null): string => {
  if (!draft) return 'Removed';
  if (draft.itemType === 'note') return draft.noteText || 'Note';
  if (draft.itemType === 'section') return draft.sectionName || 'Section';
  const sideTag = draft.side !== 'both' ? ` (${draft.side === 'left' ? 'L' : 'R'})` : '';
  return `${itemDisplayName(draft)}${sideTag} — ${itemMetaText(draft)}`;
};

export const GroupPlanEditor = ({
  group,
  date,
  clubId,
  userId,
  canEdit,
  athletes,
  exerciseGroupTypes,
  exercises,
  conditioningExercises,
  runningExercises,
  onExercisesChanged,
  onMemberChanged,
}: {
  group: GymSessionGroup;
  date: string;
  clubId: string;
  userId: string;
  canEdit: boolean;
  athletes: Athlete[];
  exerciseGroupTypes: GymExerciseGroupType[];
  exercises: GymExercise[];
  conditioningExercises: GymConditioningExercise[];
  runningExercises: GymRunningExercise[];
  onExercisesChanged: () => void;
  /** Called after any change that fans out to members, so a parent showing per-member counts elsewhere can refresh. */
  onMemberChanged?: () => void;
}) => {
  const { pushUndo } = useGymUndo();
  const members = athletes.filter(a => group.memberAthleteIds.includes(a.id));

  const [planId, setPlanId] = useState<string | null>(null);
  const [items, setItems] = useState<GymGroupPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<GymGroupPlanConflict[]>([]);
  const [lastSyncNote, setLastSyncNote] = useState<string | null>(null);

  const [draft, setDraft] = useState<GymSessionItemDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [addingNewExercise, setAddingNewExercise] = useState(false);
  const [newExerciseTypeAttrs, setNewExerciseTypeAttrs] = useState<GroupTypeAttrs>(emptyGroupTypeAttrs);
  const [splitSide, setSplitSide] = useState(false);
  const [rightDraft, setRightDraft] = useState<{ sets: number | null; reps: number | null; load: string | null; loadKg: number | null; tempo: string | null }>({ sets: null, reps: null, load: null, loadKg: null, tempo: null });
  // Timer's Minutes/Seconds inputs are kept separate from draft.durationSeconds for entry ergonomics.
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [createExerciseError, setCreateExerciseError] = useState<string | null>(null);
  const [newRunningDistance, setNewRunningDistance] = useState('');
  // Round 18: "frequently used" quick-pick for the Section name field.
  const [frequentSectionNames, setFrequentSectionNames] = useState<string[]>([]);

  // Focus jumps straight to Sets right after an exercise is picked/created.
  const setsInputRef = useRef<HTMLInputElement>(null);

  // Superset drag-and-drop — see supersetDnd.ts / SessionEditor.tsx (same mechanism, applied
  // to this shared group plan's own item order instead of one athlete's session).
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  const [dragKeepTogether, setDragKeepTogether] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const plan = await getOrCreateGroupPlan(clubId, group.id, date, userId);
      setPlanId(plan.id);
      setItems(await fetchGroupPlanItems(plan.id));
    } catch (err) {
      console.error('[GroupPlanEditor] failed to load group plan', err);
    } finally {
      setLoading(false);
    }
  }, [clubId, group.id, date, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchFrequentSectionNames(clubId)
      .then(setFrequentSectionNames)
      .catch(err => console.error('[GroupPlanEditor] failed to load frequent section names', err));
  }, [clubId]);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setEditingId(null);
    setExerciseQuery('');
    setShowPicker(false);
    setAddingNewExercise(false);
    setNewExerciseTypeAttrs(emptyGroupTypeAttrs);
    setSplitSide(false);
    setRightDraft({ sets: null, reps: null, load: null, loadKg: null, tempo: null });
    setTimerMinutes(null);
    setTimerSeconds(null);
    setCreateExerciseError(null);
    setNewRunningDistance('');
  };

  /** Recombine the Minutes/Seconds inputs into draft.durationSeconds. */
  const updateTimerDuration = (minutes: number | null, seconds: number | null) => {
    setTimerMinutes(minutes);
    setTimerSeconds(seconds);
    const total = minutes == null && seconds == null ? null : (minutes || 0) * 60 + (seconds || 0);
    setDraft(d => ({ ...d, durationSeconds: total }));
  };

  const switchItemType = (t: GymSessionItemDraft['itemType']) => {
    if (editingId) return;
    setDraft({ ...emptyDraft, itemType: t, distanceUnit: t === 'running' ? 'm' : null });
    setExerciseQuery('');
    setShowPicker(false);
    setAddingNewExercise(false);
    setNewExerciseTypeAttrs(emptyGroupTypeAttrs);
    setCreateExerciseError(null);
    setSplitSide(false);
    setRightDraft({ sets: null, reps: null, load: null, loadKg: null, tempo: null });
    setTimerMinutes(null);
    setTimerSeconds(null);
    setNewRunningDistance('');
  };

  const isDraftValid =
    draft.itemType === 'exercise' ? !!draft.exerciseId :
    draft.itemType === 'conditioning' ? !!draft.conditioningExerciseId :
    draft.itemType === 'running' ? !!draft.runningExerciseId :
    draft.itemType === 'note' ? !!draft.noteText?.trim() :
    draft.itemType === 'timer' ? !!draft.timerLabel?.trim() && draft.durationSeconds != null :
    draft.itemType === 'section' ? !!draft.sectionName?.trim() :
    false;

  const matches = searchExercises(exercises, exerciseQuery);
  const conditioningMatches = searchConditioningExercises(conditioningExercises, exerciseQuery);
  const runningMatches = searchRunningExercises(runningExercises, exerciseQuery);
  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupTypeId ?? null;

  const handlePickExercise = (ex: GymExercise) => {
    setDraft(d => ({ ...d, exerciseId: ex.id, exerciseName: ex.name }));
    setExerciseQuery(ex.name);
    setShowPicker(false);
    setTimeout(() => setsInputRef.current?.focus(), 0);
  };

  const handleCreateExercise = async () => {
    if (!exerciseQuery.trim() || !isGroupTypeAttrsComplete(newExerciseTypeAttrs)) return;
    setCreatingExercise(true);
    setCreateExerciseError(null);
    try {
      const type = await findOrCreateExerciseGroupType(clubId, newExerciseTypeAttrs, userId);
      const created = await createExercise(clubId, exerciseQuery.trim(), type.id, userId);
      onExercisesChanged();
      setDraft(d => ({ ...d, exerciseId: created.id, exerciseName: created.name }));
      setAddingNewExercise(false);
      setShowPicker(false);
      setTimeout(() => setsInputRef.current?.focus(), 0);
    } catch (err: any) {
      if (err?.code === '23505') {
        setCreateExerciseError('An exercise with this name already exists in this group\'s exercise bank.');
      } else {
        setCreateExerciseError(err?.message || 'Failed to create this exercise — please try again.');
      }
    } finally {
      setCreatingExercise(false);
    }
  };

  const handlePickConditioningExercise = (ex: GymConditioningExercise) => {
    setDraft(d => ({ ...d, conditioningExerciseId: ex.id, conditioningExerciseName: ex.name }));
    setExerciseQuery(ex.name);
    setShowPicker(false);
    setTimeout(() => setsInputRef.current?.focus(), 0);
  };

  const handleCreateConditioningExercise = async () => {
    if (!exerciseQuery.trim()) return;
    setCreatingExercise(true);
    setCreateExerciseError(null);
    try {
      const created = await createConditioningExercise(clubId, exerciseQuery.trim(), userId);
      onExercisesChanged();
      setDraft(d => ({ ...d, conditioningExerciseId: created.id, conditioningExerciseName: created.name }));
      setAddingNewExercise(false);
      setShowPicker(false);
      setTimeout(() => setsInputRef.current?.focus(), 0);
    } catch (err: any) {
      if (err?.code === '23505') {
        setCreateExerciseError('A conditioning exercise with this name already exists.');
      } else {
        setCreateExerciseError(err?.message || 'Failed to create this exercise — please try again.');
      }
    } finally {
      setCreatingExercise(false);
    }
  };

  const handlePickRunningExercise = (ex: GymRunningExercise) => {
    setDraft(d => ({ ...d, runningExerciseId: ex.id, runningExerciseName: ex.name, runningExerciseDistanceMeters: ex.distanceMeters }));
    setExerciseQuery(ex.name);
    setShowPicker(false);
  };

  const handleCreateRunningExercise = async () => {
    const distance = Number(newRunningDistance);
    if (!exerciseQuery.trim() || !newRunningDistance || !(distance > 0)) return;
    setCreatingExercise(true);
    setCreateExerciseError(null);
    try {
      const created = await createRunningExercise(clubId, exerciseQuery.trim(), distance, userId);
      onExercisesChanged();
      setDraft(d => ({ ...d, runningExerciseId: created.id, runningExerciseName: created.name, runningExerciseDistanceMeters: created.distanceMeters }));
      setAddingNewExercise(false);
      setShowPicker(false);
      setNewRunningDistance('');
    } catch (err: any) {
      if (err?.code === '23505') {
        setCreateExerciseError('A running exercise with this name already exists.');
      } else {
        setCreateExerciseError(err?.message || 'Failed to create this exercise — please try again.');
      }
    } finally {
      setCreatingExercise(false);
    }
  };

  const runSync = async (planItemId: string, before: GymGroupPlanItem | null, after: GymGroupPlanItem | null) => {
    const result = await syncGroupPlanItemChange(clubId, group.id, group.memberAthleteIds, date, planItemId, before, after, exerciseGroupIdFor, userId);
    if (result.conflicts.length > 0) {
      setConflicts(prev => [...prev, ...result.conflicts]);
      setLastSyncNote(`Applied to ${result.appliedCount} player${result.appliedCount !== 1 ? 's' : ''} automatically — ${result.conflicts.length} need a decision below.`);
    } else if (result.appliedCount > 0) {
      setLastSyncNote(`Applied to ${result.appliedCount} player${result.appliedCount !== 1 ? 's' : ''}.`);
    }
    onMemberChanged?.();
  };

  const handleStartEdit = (item: GymGroupPlanItem) => {
    setDraft({ ...groupPlanItemToDraft(item), id: item.id });
    setEditingId(item.id);
    setExerciseQuery(item.exerciseName || item.conditioningExerciseName || item.runningExerciseName || '');
    setShowPicker(false);
    setAddingNewExercise(false);
    setSplitSide(false);
    if (item.itemType === 'timer' && item.durationSeconds != null) {
      setTimerMinutes(Math.floor(item.durationSeconds / 60));
      setTimerSeconds(item.durationSeconds % 60);
    } else {
      setTimerMinutes(null);
      setTimerSeconds(null);
    }
  };

  const handleSave = async () => {
    if (!isDraftValid) return;
    if (!planId) return;
    setSaving(true);
    try {
      if (!editingId && draft.itemType === 'exercise' && splitSide) {
        const leftDraft: GymSessionItemDraft = { ...draft, side: 'left' };
        const rightDraftFull: GymSessionItemDraft = { ...draft, side: 'right', sets: rightDraft.sets, reps: rightDraft.reps, load: rightDraft.load, loadKg: rightDraft.loadKg, tempo: rightDraft.tempo };
        const savedLeft = await saveGroupPlanItem(planId, leftDraft, items.length, userId);
        const savedRight = await saveGroupPlanItem(planId, rightDraftFull, items.length + 1, userId);
        await runSync(savedLeft.id, null, savedLeft);
        await runSync(savedRight.id, null, savedRight);
        pushUndo({
          label: `Remove "${savedLeft.exerciseName}" (L/R) from ${group.name}'s plan`,
          run: async () => {
            await deleteGroupPlanItem(savedLeft.id);
            await deleteGroupPlanItem(savedRight.id);
            await load();
          },
        });
      } else if (!editingId) {
        const saved = await saveGroupPlanItem(planId, draft, items.length, userId);
        await runSync(saved.id, null, saved);
        pushUndo({
          label: `Remove "${itemDisplayName(saved)}" from ${group.name}'s plan`,
          run: async () => {
            await deleteGroupPlanItem(saved.id);
            await load();
          },
        });
      } else {
        const before = items.find(i => i.id === editingId) || null;
        const sortOrder = before?.sortOrder ?? items.length;
        const saved = await saveGroupPlanItem(planId, { ...draft, id: editingId }, sortOrder, userId);
        await runSync(editingId, before, saved);
      }
      resetDraft();
      await load();
    } catch (err: any) {
      console.error('[GroupPlanEditor] failed to save plan item', err);
      window.alert(err?.message || 'Failed to save this change to the group plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: GymGroupPlanItem) => {
    if (!window.confirm(`Remove "${itemDisplayName(item)}" from ${group.name}'s plan for every player?`)) return;
    setSaving(true);
    try {
      await deleteGroupPlanItem(item.id);
      await runSync(item.id, item, null);
      await load();
    } catch (err: any) {
      console.error('[GroupPlanEditor] failed to delete plan item', err);
      window.alert(err?.message || 'Failed to remove this from the group plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleDragStartItem = (itemId: string) => {
    setDraggedIds([itemId]);
    setDragKeepTogether(false);
  };

  const handleDragStartGroup = (memberIds: string[]) => {
    setDraggedIds(memberIds);
    setDragKeepTogether(true);
  };

  const handleDragOverRow = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    let zone = zoneForOffset(e.clientY - rect.top, rect.height);
    // Sections have no interaction with Supersets (Joanne's answer, round
    // 17) — never let one merge into/receive a superset, only reorder.
    if (zone === 'merge') {
      const targetItem = items.find(i => i.id === targetId);
      const draggingSection = (draggedIds || []).some(id => items.find(i => i.id === id)?.itemType === 'section');
      if (targetItem?.itemType === 'section' || draggingSection) {
        const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
        zone = ratio < 0.5 ? 'before' : 'after';
      }
    }
    setDropTarget({ id: targetId, zone });
  };

  const handleDragEndAny = () => {
    setDraggedIds(null);
    setDropTarget(null);
    setDragKeepTogether(false);
  };

  // Plain reordering/grouping here only changes this shared plan's own item
  // order — it doesn't fan out to members' individual sessions the way an
  // actual value change does (same as the old up/down-arrow reorder never
  // did either). Members pick up the new grouping the next time that item's
  // content is added/edited via this editor.
  const handleDropOnRow = async (targetId: string) => {
    const ids = draggedIds;
    const zone = dropTarget?.zone;
    const keepTogether = dragKeepTogether;
    setDraggedIds(null);
    setDropTarget(null);
    setDragKeepTogether(false);
    if (!ids || !zone) return;
    const result = applySupersetDrop(items, ids, targetId, zone, keepTogether);
    if (!result) return;
    const reordered = result.map((it, idx) => ({ ...it, sortOrder: idx }));
    setItems(reordered);
    await reorderGroupPlanItems(reordered.map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: it.supersetId })));
  };

  const handleUngroup = async (memberIds: string[]) => {
    const updated = items.map(it => (memberIds.includes(it.id) ? { ...it, supersetId: null } : it));
    setItems(updated);
    await reorderGroupPlanItems(updated.filter(it => memberIds.includes(it.id)).map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: null })));
  };

  const resolveConflict = async (conflict: GymGroupPlanConflict, accept: boolean) => {
    try {
      await resolveGroupPlanConflict(clubId, conflict, accept, userId);
      setConflicts(prev => prev.filter(c => c !== conflict));
      onMemberChanged?.();
    } catch (err: any) {
      console.error('[GroupPlanEditor] failed to resolve conflict', err);
      window.alert(err?.message || 'Failed to apply that decision.');
    }
  };

  // Shared add/edit form body — used both for the bottom "add to everyone's
  // plan" panel (when editingId is unset) and inline in place of the row
  // being edited (when editingId matches that row).
  const renderForm = () => (
    <>
      <p className="text-[12px] font-semibold text-slate-600 mb-2.5">{editingId ? 'Edit item' : 'Add to everyone\'s plan'}</p>
      <div className="flex flex-wrap bg-slate-100 rounded-md p-0.5 text-[12px] font-medium mb-3 w-fit gap-0.5">
        {([
          ['exercise', 'Exercise'],
          ['conditioning', 'Conditioning'],
          ['running', 'Running'],
          ['timer', 'Timer'],
          ['note', 'Note'],
          ['section', 'Section'],
        ] as const).map(([type, label]) => (
          <button
            key={type}
            onClick={() => switchItemType(type)}
            disabled={!!editingId}
            className={`px-2.5 py-1 rounded disabled:opacity-40 ${draft.itemType === type ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {draft.itemType === 'exercise' ? (
        <div className="space-y-2.5">
          <div className="relative">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Exercise</label>
            {draft.exerciseId ? (
              <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                  <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  {draft.exerciseName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(d => ({ ...d, exerciseId: null, exerciseName: undefined }));
                    setExerciseQuery('');
                    setShowPicker(true);
                  }}
                  className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={exerciseQuery}
                  onChange={e => { setExerciseQuery(e.target.value); setShowPicker(true); }}
                  onFocus={() => setShowPicker(true)}
                  placeholder="Start typing…"
                  className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showPicker && exerciseQuery.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {matches.map(ex => (
                      <button key={ex.id} onClick={() => handlePickExercise(ex)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between">
                        <span>{ex.name}</span>
                        <span className="text-[11px] text-slate-400">{ex.exerciseGroupTypeLabel}</span>
                      </button>
                    ))}
                    <button onClick={() => setAddingNewExercise(true)} className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100">
                      <Plus className="w-3.5 h-3.5" /> Add "{exerciseQuery.trim()}" as new exercise
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {addingNewExercise && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <label className="block text-[11px] font-medium text-slate-500">Exercise group type</label>
              <GroupTypePicker value={newExerciseTypeAttrs} onChange={setNewExerciseTypeAttrs} />
              {createExerciseError && (
                <p className="text-[11px] text-red-600">{createExerciseError}</p>
              )}
              <div className="flex gap-2">
                <button onClick={handleCreateExercise} disabled={!isGroupTypeAttrsComplete(newExerciseTypeAttrs) || creatingExercise} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                  {creatingExercise && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {creatingExercise ? 'Creating…' : 'Create exercise'}
                </button>
                <button onClick={() => { setAddingNewExercise(false); setCreateExerciseError(null); setNewExerciseTypeAttrs(emptyGroupTypeAttrs); }} disabled={creatingExercise} className="h-8 px-3 text-[12px] text-slate-500 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          )}

          {draft.itemType === 'exercise' && !editingId && (
            <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={splitSide} onChange={e => setSplitSide(e.target.checked)} className="w-3.5 h-3.5" />
              Split left / right
              <span className="text-slate-400">— separate sets/reps/load/intensity/tempo for each side</span>
            </label>
          )}

          {draft.itemType === 'exercise' && splitSide && !editingId ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-500">Left</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <input ref={setsInputRef} type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Load (kg)" value={draft.loadKg ?? ''} onChange={e => setDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} max={100} placeholder="Intensity %" value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input placeholder="Tempo e.g. 3-1-1-0" value={draft.tempo ?? ''} onChange={e => setDraft(d => ({ ...d, tempo: e.target.value || null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50 col-span-2" />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-500">Right</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <input type="number" min={0} placeholder="Sets" value={rightDraft.sets ?? ''} onChange={e => setRightDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Reps" value={rightDraft.reps ?? ''} onChange={e => setRightDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Load (kg)" value={rightDraft.loadKg ?? ''} onChange={e => setRightDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} max={100} placeholder="Intensity %" value={rightDraft.load ?? ''} onChange={e => setRightDraft(d => ({ ...d, load: e.target.value || null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input placeholder="Tempo e.g. 3-1-1-0" value={rightDraft.tempo ?? ''} onChange={e => setRightDraft(d => ({ ...d, tempo: e.target.value || null }))} className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50 col-span-2" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Sets</label>
                <input ref={setsInputRef} type="number" min={0} value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Reps</label>
                <input type="number" min={0} value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Load (kg)</label>
                <input type="number" min={0} value={draft.loadKg ?? ''} onChange={e => setDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))} placeholder="e.g. 60" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Intensity (%)</label>
                <input type="number" min={0} max={100} value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 75" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Tempo</label>
                <input value={draft.tempo ?? ''} onChange={e => setDraft(d => ({ ...d, tempo: e.target.value || null }))} placeholder="e.g. 3-1-1-0" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}

          {draft.itemType === 'exercise' && (
            <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={draft.isPrimary} onChange={e => setDraft(d => ({ ...d, isPrimary: e.target.checked }))} className="w-3.5 h-3.5" />
              Mark as Primary
            </label>
          )}
        </div>
      ) : draft.itemType === 'conditioning' ? (
        <div className="space-y-2.5">
          <div className="relative">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Conditioning exercise</label>
            {draft.conditioningExerciseId ? (
              <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                  <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  {draft.conditioningExerciseName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(d => ({ ...d, conditioningExerciseId: null, conditioningExerciseName: undefined }));
                    setExerciseQuery('');
                    setShowPicker(true);
                  }}
                  className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={setsInputRef}
                  value={exerciseQuery}
                  onChange={e => { setExerciseQuery(e.target.value); setShowPicker(true); }}
                  onFocus={() => setShowPicker(true)}
                  placeholder="Start typing…"
                  className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showPicker && exerciseQuery.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {conditioningMatches.map(ex => (
                      <button key={ex.id} onClick={() => handlePickConditioningExercise(ex)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50">
                        {ex.name}
                      </button>
                    ))}
                    <button onClick={() => setAddingNewExercise(true)} className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100">
                      <Plus className="w-3.5 h-3.5" /> Add "{exerciseQuery.trim()}" as new conditioning exercise
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {addingNewExercise && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              {createExerciseError && <p className="text-[11px] text-red-600">{createExerciseError}</p>}
              <div className="flex gap-2">
                <button onClick={handleCreateConditioningExercise} disabled={creatingExercise} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                  {creatingExercise && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {creatingExercise ? 'Creating…' : 'Create conditioning exercise'}
                </button>
                <button onClick={() => { setAddingNewExercise(false); setCreateExerciseError(null); }} disabled={creatingExercise} className="h-8 px-3 text-[12px] text-slate-500 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Sets</label>
              <input type="number" min={0} value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Reps</label>
              <input type="number" min={0} value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Intensity (%)</label>
              <input type="number" min={0} max={100} value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 75" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
      ) : draft.itemType === 'running' ? (
        <div className="space-y-2.5">
          <div className="relative">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Running exercise</label>
            {draft.runningExerciseId ? (
              <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                  <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  {draft.runningExerciseName}
                  <span className="text-emerald-600/70 font-normal">— {draft.runningExerciseDistanceMeters}m</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(d => ({ ...d, runningExerciseId: null, runningExerciseName: undefined, runningExerciseDistanceMeters: undefined }));
                    setExerciseQuery('');
                    setShowPicker(true);
                  }}
                  className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={exerciseQuery}
                  onChange={e => { setExerciseQuery(e.target.value); setShowPicker(true); }}
                  onFocus={() => setShowPicker(true)}
                  placeholder="Start typing…"
                  className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showPicker && exerciseQuery.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {runningMatches.map(ex => (
                      <button key={ex.id} onClick={() => handlePickRunningExercise(ex)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between">
                        <span>{ex.name}</span>
                        <span className="text-[11px] text-slate-400">{ex.distanceMeters}m</span>
                      </button>
                    ))}
                    <button onClick={() => setAddingNewExercise(true)} className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100">
                      <Plus className="w-3.5 h-3.5" /> Add "{exerciseQuery.trim()}" as new running exercise
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {addingNewExercise && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <label className="block text-[11px] font-medium text-slate-500">Distance (metres)</label>
              <input
                type="number"
                min={0}
                value={newRunningDistance}
                onChange={e => setNewRunningDistance(e.target.value)}
                placeholder="e.g. 400"
                className="w-full h-8 px-2 text-[13px] border border-slate-200 rounded bg-white"
              />
              {createExerciseError && <p className="text-[11px] text-red-600">{createExerciseError}</p>}
              <div className="flex gap-2">
                <button onClick={handleCreateRunningExercise} disabled={!newRunningDistance || creatingExercise} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                  {creatingExercise && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {creatingExercise ? 'Creating…' : 'Create running exercise'}
                </button>
                <button onClick={() => { setAddingNewExercise(false); setCreateExerciseError(null); setNewRunningDistance(''); }} disabled={creatingExercise} className="h-8 px-3 text-[12px] text-slate-500 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : draft.itemType === 'timer' ? (
        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Label</label>
            <input
              value={draft.timerLabel ?? ''}
              onChange={e => setDraft(d => ({ ...d, timerLabel: e.target.value || null }))}
              placeholder="e.g. Plank hold, Rest between sets"
              className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Minutes</label>
              <input
                ref={setsInputRef}
                type="number"
                min={0}
                value={timerMinutes ?? ''}
                onChange={e => updateTimerDuration(e.target.value ? Number(e.target.value) : null, timerSeconds)}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Seconds</label>
              <input
                type="number"
                min={0}
                max={59}
                value={timerSeconds ?? ''}
                onChange={e => updateTimerDuration(timerMinutes, e.target.value ? Number(e.target.value) : null)}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      ) : draft.itemType === 'section' ? (
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Section name</label>
          <input
            ref={setsInputRef}
            value={draft.sectionName ?? ''}
            onChange={e => setDraft(d => ({ ...d, sectionName: e.target.value || null }))}
            placeholder="e.g. Warm-up, Main lifts, Accessories"
            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {frequentSectionNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {frequentSectionNames.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, sectionName: name }))}
                  className="px-2 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1">A simple named divider in the list — no sets/reps of its own, and it can't be part of a Superset or split left/right.</p>
        </div>
      ) : (
        <textarea
          value={draft.noteText ?? ''}
          onChange={e => setDraft(d => ({ ...d, noteText: e.target.value }))}
          placeholder="Note for everyone's session…"
          rows={3}
          className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSave}
          disabled={saving || members.length === 0 || !isDraftValid}
          className="flex-1 h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {editingId ? 'Save change' : splitSide && draft.itemType === 'exercise' ? `Add both sides for all ${members.length}` : `Add for all ${members.length}`}
        </button>
        {editingId && (
          <button onClick={resetDraft} className="h-9 px-3 text-[13px] text-slate-500 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
      </div>
    </>
  );

  const renderPlanItemRow = (item: GymGroupPlanItem) => {
    // Editing happens right here, in place of this row.
    if (editingId === item.id) {
      return (
        <div key={item.id} className="px-3.5 py-3 bg-blue-50/60 border-l-2 border-blue-400">
          {renderForm()}
        </div>
      );
    }
    if (item.itemType === 'section') {
      const zone = dropTarget?.id === item.id ? dropTarget.zone : null;
      return (
        <div
          key={item.id}
          draggable={canEdit}
          onDragStart={() => handleDragStartItem(item.id)}
          onDragOver={e => handleDragOverRow(e, item.id)}
          onDrop={() => handleDropOnRow(item.id)}
          onDragEnd={handleDragEndAny}
          className={[
            'flex items-center gap-2 px-3.5 py-2 relative bg-slate-50',
            draggedIds?.includes(item.id) ? 'opacity-40' : '',
          ].filter(Boolean).join(' ')}
        >
          {zone === 'before' && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
          {zone === 'after' && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}
          {canEdit && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 cursor-grab" />}
          <span className="flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.sectionName}</span>
          {canEdit && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => handleStartEdit(item)} className="p-1 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-600">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(item)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      );
    }
    const zone = dropTarget?.id === item.id ? dropTarget.zone : null;
    return (
      <div
        key={item.id}
        draggable={canEdit}
        onDragStart={() => handleDragStartItem(item.id)}
        onDragOver={e => handleDragOverRow(e, item.id)}
        onDrop={() => handleDropOnRow(item.id)}
        onDragEnd={handleDragEndAny}
        className={[
          'flex items-start gap-2.5 px-3.5 py-2.5 relative',
          draggedIds?.includes(item.id) ? 'opacity-40' : '',
          zone === 'merge' ? 'bg-indigo-100/70' : '',
        ].filter(Boolean).join(' ')}
      >
        {zone === 'before' && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
        {zone === 'after' && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}
        {canEdit && <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-1 flex-shrink-0 cursor-grab" />}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
            {item.itemType === 'note' ? <StickyNote className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /> : null}
            {item.itemType === 'note' ? item.noteText : itemDisplayName(item)}
            {item.itemType === 'conditioning' && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 border border-teal-200">Conditioning</span>
            )}
            {item.itemType === 'exercise' && item.side !== 'both' && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1 rounded">{item.side === 'left' ? 'L' : 'R'}</span>
            )}
            {item.itemType === 'exercise' && item.isPrimary && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1 rounded">Primary</span>}
          </p>
          {item.itemType !== 'note' && <p className="text-[11px] text-slate-400">{itemMetaText(item)}</p>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={() => handleStartEdit(item)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => handleDelete(item)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6 space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <p className="text-[15px] font-bold text-slate-900 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-slate-400" /> {group.name} — All players
        </p>
        <p className="text-[12px] text-slate-400">
          {fmtDate(date)} · {members.length} player{members.length !== 1 ? 's' : ''} · changes here apply to everyone's session for this date
        </p>
      </div>

      {lastSyncNote && (
        <p className="text-[11.5px] text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{lastSyncNote}</p>
      )}

      {conflicts.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-300 overflow-hidden">
          <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[12px] font-semibold text-amber-800">
              {conflicts.length} player{conflicts.length !== 1 ? 's' : ''} customized this exercise — decide per player
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {conflicts.map((c, i) => {
              const athlete = athletes.find(a => a.id === c.athleteId);
              return (
                <div key={i} className="px-3.5 py-2.5">
                  <p className="text-[12.5px] font-medium text-slate-800 mb-1">{athlete?.name || 'Player'}</p>
                  <p className="text-[11.5px] text-slate-500">Current: <span className="text-slate-700">{draftLabel(c.currentDraft)}</span></p>
                  <p className="text-[11.5px] text-slate-500 mb-1.5">New plan: <span className="text-slate-700">{draftLabel(c.newDraft)}</span></p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolveConflict(c, true)}
                      className="h-7 px-2.5 text-[11.5px] font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
                    >
                      Accept new
                    </button>
                    <button
                      onClick={() => resolveConflict(c, false)}
                      className="h-7 px-2.5 text-[11.5px] font-medium border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
                    >
                      Keep current
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {canEdit && !editingId && (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          {renderForm()}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        <div className="px-3.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Group plan ({items.length})</div>
        {groupBySuperset(items).map(group => {
          if (!group.supersetId) return renderPlanItemRow(group.members[0]);
          return (
            <div key={group.supersetId} className="bg-indigo-50/40">
              <div
                draggable={canEdit}
                onDragStart={() => handleDragStartGroup(group.members.map(m => m.id))}
                onDragEnd={handleDragEndAny}
                className="flex items-center gap-1.5 px-3.5 pt-2 pb-1 cursor-grab select-none"
              >
                {canEdit && <GripVertical className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />}
                <Link2 className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">Superset</span>
                {canEdit && (
                  <button
                    onClick={() => handleUngroup(group.members.map(m => m.id))}
                    className="ml-auto text-[10px] text-indigo-400 hover:text-indigo-700 hover:underline"
                  >
                    Ungroup
                  </button>
                )}
              </div>
              <div className="divide-y divide-indigo-100/70 ml-3.5 border-l-2 border-indigo-300">
                {group.members.map(item => renderPlanItemRow(item))}
              </div>
            </div>
          );
        })}
        {items.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">Nothing planned for this group yet.</div>}
      </div>
    </div>
  );
};
