// components/gym/SessionEditor.tsx
// Create/edit one athlete's Gym session for one date: an ordered list of
// exercise and note items (drag-and-drop reorder, edit, delete, optional
// left/right split), an exercise picker with type-ahead + inline "add new
// exercise", Sets/Reps/Load + Primary, the swapped-exercise indicator, an
// owner filter, and a "Copy session…" action. Every mutation here pushes an
// inverse action onto the shared undo stack (GymUndoContext) right after it
// succeeds. Reused both as the desktop split-pane's right column and as the
// full-screen mobile destination — see GymUI2Root.tsx.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, Check, Copy, Edit2, GripVertical, Link2, Loader2, Plus, RefreshCw, StickyNote, Trash2, X } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymConditioningExercise, GymExercise, GymExerciseGroupType, GymRunningExercise, GymSession, GymSessionGroup, GymSessionItem, GymSessionItemDraft } from './types';
import {
  fetchAthleteSessionsForDateRange,
  getOrCreateSession,
  saveSessionItem,
  deleteSessionItem,
  reorderSessionItems,
  setSessionItemsSuperset,
  createExercise,
  searchExercises,
  createConditioningExercise,
  searchConditioningExercises,
  createRunningExercise,
  searchRunningExercises,
  findOrCreateExerciseGroupType,
  itemToDraft,
  fetchFrequentSectionNames,
} from './gymApi';
import { applySupersetDrop, groupBySuperset, zoneForOffset, type DropZone } from './supersetDnd';
import { CopySessionModal } from './CopySessionModal';
import { useGymUndo } from './GymUndoContext';
import { itemDisplayName, itemMetaText } from './itemDisplay';
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
const sideLabel = (side: string) => (side === 'left' ? 'Left' : side === 'right' ? 'Right' : '');

export const SessionEditor = ({
  athlete,
  athleteId,
  date,
  clubId,
  userId,
  canEdit,
  exerciseGroupTypes,
  exercises,
  conditioningExercises,
  runningExercises,
  athletes,
  sessionGroups,
  onExercisesChanged,
  onBack,
}: {
  athlete?: Athlete;
  athleteId: string;
  date: string;
  clubId: string;
  userId: string;
  canEdit: boolean;
  exerciseGroupTypes: GymExerciseGroupType[];
  exercises: GymExercise[];
  conditioningExercises: GymConditioningExercise[];
  runningExercises: GymRunningExercise[];
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  onExercisesChanged: () => void;
  onBack?: () => void;
}) => {
  const { pushUndo } = useGymUndo();

  const [session, setSession] = useState<GymSession | null>(null);
  const [items, setItems] = useState<GymSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<GymSessionItemDraft>(emptyDraft);
  const [editingSortOrder, setEditingSortOrder] = useState<number | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [addingNewExercise, setAddingNewExercise] = useState(false);
  const [newExerciseTypeAttrs, setNewExerciseTypeAttrs] = useState<GroupTypeAttrs>(emptyGroupTypeAttrs);
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [createExerciseError, setCreateExerciseError] = useState<string | null>(null);
  const [splitSide, setSplitSide] = useState(false);
  // Round 18: "frequently used" quick-pick for the Section name field —
  // loaded once, lazily, not blocking the main session load.
  const [frequentSectionNames, setFrequentSectionNames] = useState<string[]>([]);
  const [rightDraft, setRightDraft] = useState<{ sets: number | null; reps: number | null; load: string | null; loadKg: number | null; tempo: string | null }>({ sets: null, reps: null, load: null, loadKg: null, tempo: null });
  // Timer's Minutes/Seconds inputs are kept separate from draft.durationSeconds
  // for entry ergonomics — each keystroke recombines them into that one field.
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  // Distance (metres) entered only while creating a brand-new Running-list
  // entry — the picked/created entry's own distance is what actually saves.
  const [newRunningDistance, setNewRunningDistance] = useState('');

  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  // Superset drag-and-drop — see supersetDnd.ts. draggedIds holds either one
  // item's id (dragging a single row's own grip) or every member of a
  // superset (dragging its group-level grip, dragKeepTogether = true so the
  // whole block moves as a unit instead of dissolving).
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  const [dragKeepTogether, setDragKeepTogether] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);

  // Multi-select items directly in the list (rather than only inside the Copy
  // modal), so the same selection drives both Copy and Delete — always
  // available (no separate "Select" mode to switch into first). Whenever a
  // session (re)loads, every item starts pre-selected, same as clicking the
  // old "Select" button used to do.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Focus jumps straight to Sets right after an exercise is picked/created,
  // so sets/reps/intensity can be filled in without hunting for the field.
  const setsInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await fetchAthleteSessionsForDateRange(athleteId, [date]);
      const found = sessions[0] || null;
      setSession(found);
      setItems(found?.items || []);
      setSelectedItemIds(new Set((found?.items || []).map(i => i.id)));
    } catch (err) {
      console.error('[SessionEditor] failed to load session', err);
    } finally {
      setLoading(false);
    }
  }, [athleteId, date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOwnerFilter('all'); }, [athleteId, date]);
  useEffect(() => {
    fetchFrequentSectionNames(clubId)
      .then(setFrequentSectionNames)
      .catch(err => console.error('[SessionEditor] failed to load frequent section names', err));
  }, [clubId]);

  const ensureSession = async (): Promise<GymSession> => {
    if (session) return session;
    const created = await getOrCreateSession(clubId, athleteId, date, userId);
    setSession(created);
    return created;
  };

  const resetDraft = () => {
    setDraft(emptyDraft);
    setEditingSortOrder(null);
    setExerciseQuery('');
    setShowPicker(false);
    setAddingNewExercise(false);
    setNewExerciseTypeAttrs(emptyGroupTypeAttrs);
    setSplitSide(false);
    setRightDraft({ sets: null, reps: null, load: null, loadKg: null, tempo: null });
    setTimerMinutes(null);
    setTimerSeconds(null);
    setNewRunningDistance('');
  };

  /** Recombine the Minutes/Seconds inputs into draft.durationSeconds. */
  const updateTimerDuration = (minutes: number | null, seconds: number | null) => {
    setTimerMinutes(minutes);
    setTimerSeconds(seconds);
    const total = minutes == null && seconds == null ? null : (minutes || 0) * 60 + (seconds || 0);
    setDraft(d => ({ ...d, durationSeconds: total }));
  };

  const matches = searchExercises(exercises, exerciseQuery);
  const conditioningMatches = searchConditioningExercises(conditioningExercises, exerciseQuery);
  const runningMatches = searchRunningExercises(runningExercises, exerciseQuery);

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
      // Postgres unique-violation — most commonly this name was used by an
      // exercise that's since been merged away (see migration 0006).
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

  const handleStartEdit = (item: GymSessionItem) => {
    setDraft({ ...itemToDraft(item), id: item.id });
    setEditingSortOrder(item.sortOrder);
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

  const exerciseGroupIdForDraft = (d: GymSessionItemDraft) => exercises.find(e => e.id === d.exerciseId)?.exerciseGroupTypeId || null;

  const handleAddItem = async () => {
    if (draft.itemType === 'exercise' && !draft.exerciseId) return;
    if (draft.itemType === 'conditioning' && !draft.conditioningExerciseId) return;
    if (draft.itemType === 'running' && !draft.runningExerciseId) return;
    if (draft.itemType === 'note' && !draft.noteText?.trim()) return;
    if (draft.itemType === 'timer' && (!draft.timerLabel?.trim() || draft.durationSeconds == null)) return;
    if (draft.itemType === 'section' && !draft.sectionName?.trim()) return;
    setSaving(true);
    try {
      const s = await ensureSession();
      const exerciseGroupId = draft.itemType === 'exercise' ? exerciseGroupIdForDraft(draft) : null;

      if (!draft.id && draft.itemType === 'exercise' && splitSide) {
        // New split entry — save two independent items, Left then Right.
        const leftDraft: GymSessionItemDraft = { ...draft, side: 'left' };
        const rightDraftFull: GymSessionItemDraft = { ...draft, side: 'right', sets: rightDraft.sets, reps: rightDraft.reps, load: rightDraft.load, loadKg: rightDraft.loadKg, tempo: rightDraft.tempo };
        const savedLeft = await saveSessionItem(s.id, athleteId, leftDraft, exerciseGroupId, items.length, userId);
        const savedRight = await saveSessionItem(s.id, athleteId, rightDraftFull, exerciseGroupId, items.length + 1, userId);
        setItems(prev => [...prev, savedLeft, savedRight]);
        pushUndo({
          label: `Remove "${savedLeft.exerciseName}" (L/R)`,
          run: async () => {
            await deleteSessionItem(savedLeft.id);
            await deleteSessionItem(savedRight.id);
            setItems(prev => prev.filter(i => i.id !== savedLeft.id && i.id !== savedRight.id));
          },
        });
        resetDraft();
        return;
      }

      const sortOrder = draft.id && editingSortOrder !== null ? editingSortOrder : items.length;
      const previousItem = draft.id ? items.find(i => i.id === draft.id) : undefined;
      const saved = await saveSessionItem(s.id, athleteId, draft, exerciseGroupId, sortOrder, userId);
      setItems(prev => (draft.id ? prev.map(i => (i.id === saved.id ? saved : i)) : [...prev, saved]));

      if (draft.id && previousItem) {
        const sessionId = s.id;
        pushUndo({
          label: `Undo edit to "${previousItem.exerciseName || previousItem.noteText || previousItem.sectionName || 'item'}"`,
          run: async () => {
            const oldDraft: GymSessionItemDraft = { ...itemToDraft(previousItem), id: previousItem.id };
            const restoredGroupId = previousItem.itemType === 'exercise' ? exerciseGroupIdForDraft(oldDraft) : null;
            const restored = await saveSessionItem(sessionId, athleteId, oldDraft, restoredGroupId, previousItem.sortOrder, userId);
            setItems(prev => prev.map(i => (i.id === restored.id ? restored : i)));
          },
        });
      } else if (!draft.id) {
        const sessionId = s.id;
        pushUndo({
          label: `Remove "${saved.exerciseName || saved.noteText || saved.sectionName || 'item'}"`,
          run: async () => {
            await deleteSessionItem(saved.id);
            setItems(prev => prev.filter(i => i.id !== saved.id));
          },
        });
      }
      resetDraft();
    } catch (err: any) {
      console.error('[SessionEditor] failed to save item', err);
      window.alert(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('Remove this item?')) return;
    const item = items.find(i => i.id === itemId);
    const sessionId = session?.id;
    await deleteSessionItem(itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    if (draft.id === itemId) resetDraft();

    if (item && sessionId) {
      pushUndo({
        label: `Restore "${item.exerciseName || item.noteText || item.sectionName || 'item'}"`,
        run: async () => {
          const oldDraft = itemToDraft(item);
          const restoredGroupId = item.itemType === 'exercise' ? exerciseGroupIdForDraft(oldDraft) : null;
          const restored = await saveSessionItem(sessionId, athleteId, oldDraft, restoredGroupId, item.sortOrder, userId);
          setItems(prev => [...prev, restored].sort((a, b) => a.sortOrder - b.sortOrder));
        },
      });
    }
  };

  const toggleSelected = (itemId: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedItemIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${ids.length} item${ids.length !== 1 ? 's' : ''}?`)) return;
    const idSet = new Set(ids);
    const toDelete = items.filter(i => idSet.has(i.id)).sort((a, b) => a.sortOrder - b.sortOrder);
    const sessionId = session?.id;
    for (const id of ids) await deleteSessionItem(id);
    setItems(prev => prev.filter(i => !idSet.has(i.id)));
    setSelectedItemIds(new Set());
    if (draft.id && idSet.has(draft.id)) resetDraft();

    if (sessionId && toDelete.length > 0) {
      pushUndo({
        label: `Restore ${toDelete.length} item${toDelete.length !== 1 ? 's' : ''}`,
        run: async () => {
          const idMap = new Map<string, string>();
          for (const item of toDelete) {
            const oldDraft = itemToDraft(item);
            const restoredGroupId = item.itemType === 'exercise' ? exerciseGroupIdForDraft(oldDraft) : null;
            const restored = await saveSessionItem(sessionId, athleteId, oldDraft, restoredGroupId, item.sortOrder, userId);
            idMap.set(item.id, restored.id);
            setItems(prev => [...prev, restored].sort((a, b) => a.sortOrder - b.sortOrder));
          }
          const bySuperset = new Map<string, string[]>();
          for (const item of toDelete) {
            if (!item.supersetId) continue;
            const newId = idMap.get(item.id);
            if (!newId) continue;
            if (!bySuperset.has(item.supersetId)) bySuperset.set(item.supersetId, []);
            bySuperset.get(item.supersetId)!.push(newId);
          }
          for (const [supersetId, newIds] of bySuperset) {
            if (newIds.length > 1) {
              await setSessionItemsSuperset(newIds, supersetId);
              setItems(prev => prev.map(it => (newIds.includes(it.id) ? { ...it, supersetId } : it)));
            }
          }
        },
      });
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
    const prevItems = items;
    const prevOrder = items.map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: it.supersetId }));
    const reordered = result.map((it, idx) => ({ ...it, sortOrder: idx }));
    setItems(reordered);
    try {
      await reorderSessionItems(reordered.map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: it.supersetId })));
      pushUndo({
        label: 'Undo reorder',
        run: async () => {
          await reorderSessionItems(prevOrder);
          setItems(prevItems);
        },
      });
    } catch (err) {
      console.error('[SessionEditor] failed to persist reorder', err);
      load();
    }
  };

  const handleUngroup = async (memberIds: string[]) => {
    const prevItems = items;
    const prevOrder = items.map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: it.supersetId }));
    const updated = items.map(it => (memberIds.includes(it.id) ? { ...it, supersetId: null } : it));
    setItems(updated);
    try {
      await reorderSessionItems(updated.filter(it => memberIds.includes(it.id)).map(it => ({ id: it.id, sortOrder: it.sortOrder, supersetId: null })));
      pushUndo({
        label: 'Undo ungroup',
        run: async () => {
          await reorderSessionItems(prevOrder);
          setItems(prevItems);
        },
      });
    } catch (err) {
      console.error('[SessionEditor] failed to ungroup', err);
      load();
    }
  };

  const creators = Array.from(
    new Map(items.filter(i => i.createdBy).map(i => [i.createdBy as string, i.createdByName || 'Unknown'])).entries()
  );
  const visibleItems = ownerFilter === 'all' ? items : items.filter(i => i.createdBy === ownerFilter);
  const canReorder = canEdit && ownerFilter === 'all';
  const visibleIndexById = new Map(visibleItems.map((it, idx) => [it.id, idx]));

  // The add/edit form body — used both for the bottom "add new item" panel
  // (when draft.id is unset) and inline in place of the row being edited
  // (when draft.id matches that row) via renderItemRow below.
  const switchItemType = (t: GymSessionItemDraft['itemType']) => {
    if (draft.id) return; // the type toggle is disabled while editing an existing item anyway
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

  // Mirrors handleAddItem's own validation gate, kept in sync with it so the
  // Save/Add button's disabled state never lags behind what would actually
  // be rejected on submit.
  const isDraftValid =
    draft.itemType === 'exercise' ? !!draft.exerciseId :
    draft.itemType === 'conditioning' ? !!draft.conditioningExerciseId :
    draft.itemType === 'running' ? !!draft.runningExerciseId :
    draft.itemType === 'note' ? !!draft.noteText?.trim() :
    draft.itemType === 'timer' ? !!draft.timerLabel?.trim() && draft.durationSeconds != null :
    draft.itemType === 'section' ? !!draft.sectionName?.trim() :
    false;

  const renderForm = () => (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex flex-wrap bg-slate-100 rounded-md p-0.5 text-[12px] font-medium w-fit gap-0.5">
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
              disabled={!!draft.id}
              className={`px-2.5 py-1 rounded disabled:opacity-40 ${draft.itemType === type ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {draft.id && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
            <Edit2 className="w-3 h-3" /> Editing item {items.findIndex(i => i.id === draft.id) + 1}
            {draft.side !== 'both' ? ` (${sideLabel(draft.side)})` : ''}
          </span>
        )}
      </div>

      {draft.itemType === 'exercise' ? (
        <div className="space-y-2.5">
          <div className="relative">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Exercise</label>
            {draft.exerciseId ? (
              // Locked-in confirmation once an exercise is chosen — replaces the
              // free-text box so it's never ambiguous whether the pick "took".
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
                  onChange={e => {
                    setExerciseQuery(e.target.value);
                    setShowPicker(true);
                  }}
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
                    <button
                      onClick={() => { setAddingNewExercise(true); setShowPicker(false); }}
                      className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100"
                    >
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

          {draft.itemType === 'exercise' && !draft.id && (
            <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={splitSide} onChange={e => setSplitSide(e.target.checked)} className="w-3.5 h-3.5" />
              Split left / right
            </label>
          )}

          {draft.itemType === 'exercise' && splitSide && !draft.id ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-500">Left</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <input ref={setsInputRef} type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Load (kg)" value={draft.loadKg ?? ''} onChange={e => setDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} max={100} placeholder="Intensity %" value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input placeholder="Tempo e.g. 3-1-1-0" value={draft.tempo ?? ''} onChange={e => setDraft(d => ({ ...d, tempo: e.target.value || null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50 col-span-2" />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-500">Right</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <input type="number" min={0} placeholder="Sets" value={rightDraft.sets ?? ''} onChange={e => setRightDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Reps" value={rightDraft.reps ?? ''} onChange={e => setRightDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} placeholder="Load (kg)" value={rightDraft.loadKg ?? ''} onChange={e => setRightDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input type="number" min={0} max={100} placeholder="Intensity %" value={rightDraft.load ?? ''} onChange={e => setRightDraft(d => ({ ...d, load: e.target.value || null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                  <input placeholder="Tempo e.g. 3-1-1-0" value={rightDraft.tempo ?? ''} onChange={e => setRightDraft(d => ({ ...d, tempo: e.target.value || null }))}
                    className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50 col-span-2" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Sets</label>
                <input ref={setsInputRef} type="number" min={0} value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Reps</label>
                <input type="number" min={0} value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Load (kg)</label>
                <input type="number" min={0} value={draft.loadKg ?? ''} onChange={e => setDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))} placeholder="e.g. 60"
                  className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Intensity (%)</label>
                <input type="number" min={0} max={100} value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 75"
                  className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Tempo</label>
                <input value={draft.tempo ?? ''} onChange={e => setDraft(d => ({ ...d, tempo: e.target.value || null }))} placeholder="e.g. 3-1-1-0"
                  className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}

          {draft.itemType === 'exercise' && (
            <div>
              <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={draft.isPrimary} onChange={e => setDraft(d => ({ ...d, isPrimary: e.target.checked }))} className="w-3.5 h-3.5" />
                Primary Exercise
              </label>
              <p className="text-[11px] text-slate-400 mt-1 ml-6">may be swapped to the player's own default for this exercise's group</p>
            </div>
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
                    <button
                      onClick={() => { setAddingNewExercise(true); setShowPicker(false); }}
                      className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100"
                    >
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
              <input type="number" min={0} value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Reps</label>
              <input type="number" min={0} value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Intensity (%)</label>
              <input type="number" min={0} max={100} value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 75"
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                    <button
                      onClick={() => { setAddingNewExercise(true); setShowPicker(false); }}
                      className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100"
                    >
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
          placeholder="Note for this session…"
          rows={3}
          className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleAddItem}
          disabled={saving || !isDraftValid}
          className="flex-1 h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {draft.id ? 'Save changes' : splitSide ? 'Add both sides' : 'Add to session'}
        </button>
        {draft.id && (
          <button onClick={resetDraft} className="h-9 px-3 flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
      </div>
    </>
  );

  const renderItemRow = (item: GymSessionItem, idx: number, inGroup: boolean) => {
    // Editing happens right here, in place of this row, instead of in a
    // separate panel below the whole list — no scrolling back and forth.
    if (draft.id === item.id) {
      return (
        <div key={item.id} className="px-3.5 py-3 bg-blue-50/60 border-l-2 border-blue-400">
          {renderForm()}
        </div>
      );
    }
    if (item.itemType === 'section') {
      // A simple named divider — no Sets/Reps meta, never part of a
      // Superset, rendered distinctly from an exercise/note/etc. row.
      const zone = dropTarget?.id === item.id ? dropTarget.zone : null;
      return (
        <div
          key={item.id}
          draggable={canReorder}
          onDragStart={() => handleDragStartItem(item.id)}
          onDragOver={e => handleDragOverRow(e, item.id)}
          onDrop={() => handleDropOnRow(item.id)}
          onDragEnd={handleDragEndAny}
          className={[
            'px-3.5 py-2 flex items-center gap-2 relative bg-slate-50',
            draggedIds?.includes(item.id) ? 'opacity-40' : '',
          ].filter(Boolean).join(' ')}
        >
          {zone === 'before' && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
          {zone === 'after' && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}
          <input
            type="checkbox"
            checked={selectedItemIds.has(item.id)}
            onChange={() => toggleSelected(item.id)}
            className="w-3.5 h-3.5 flex-shrink-0"
          />
          {canReorder && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 cursor-grab" />}
          <span className="flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.sectionName}</span>
          {canEdit && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => handleStartEdit(item)} className="p-1 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-600">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDeleteItem(item.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
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
        draggable={canReorder}
        onDragStart={() => handleDragStartItem(item.id)}
        onDragOver={e => handleDragOverRow(e, item.id)}
        onDrop={() => handleDropOnRow(item.id)}
        onDragEnd={handleDragEndAny}
        className={[
          'px-3.5 py-3 flex items-start gap-2 relative',
          draggedIds?.includes(item.id) ? 'opacity-40' : '',
          selectedItemIds.has(item.id) ? 'bg-blue-50/60' : '',
          zone === 'merge' ? 'bg-indigo-100/70' : '',
        ].filter(Boolean).join(' ')}
      >
        {zone === 'before' && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
        {zone === 'after' && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}
        <input
          type="checkbox"
          checked={selectedItemIds.has(item.id)}
          onChange={() => toggleSelected(item.id)}
          className="w-3.5 h-3.5 mt-1 flex-shrink-0"
        />
        {canReorder && <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-1 flex-shrink-0 cursor-grab" />}
        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
          {idx + 1}
        </span>
        <div className="flex-1 min-w-0">
          {item.itemType === 'note' ? (
            <div className="flex items-start gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-slate-300 mt-0.5 flex-shrink-0" />
              <p className="text-[13px] text-slate-700">{item.noteText}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-medium text-slate-800">{itemDisplayName(item)}</span>
                {item.itemType === 'conditioning' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 border border-teal-200">
                    Conditioning
                  </span>
                )}
                {item.itemType === 'exercise' && item.side !== 'both' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                    {sideLabel(item.side)}
                  </span>
                )}
                {item.itemType === 'exercise' && item.isPrimary && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                    Primary
                  </span>
                )}
                {item.itemType === 'exercise' && item.wasSwapped && (
                  <span
                    title={`Swapped from "${item.exerciseName}" to this player's default`}
                    className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> swapped
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-400 mt-0.5">{itemMetaText(item)}</p>
            </>
          )}
          {item.createdByName && <p className="text-[10px] text-slate-300 mt-1">added by {item.createdByName}</p>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={() => handleStartEdit(item)} className="p-1 rounded hover:bg-slate-100 text-slate-300 hover:text-slate-600">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => handleDeleteItem(item.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6 md:mx-0 md:w-full">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      )}

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3">
        <p className="text-[15px] font-bold text-slate-900">{athlete?.name || 'Session'}</p>
        <p className="text-[12px] text-slate-400">{fmtDate(date)}</p>
      </div>

      {canEdit && items.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-2.5 mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-medium text-slate-600">{selectedItemIds.size} selected</span>
          <button onClick={() => setSelectedItemIds(new Set(items.map(i => i.id)))} className="text-[11px] text-blue-600 hover:underline">All</button>
          <button onClick={() => setSelectedItemIds(new Set())} className="text-[11px] text-blue-600 hover:underline">None</button>
          <div className="flex-1" />
          <button
            onClick={() => setShowCopyModal(true)}
            disabled={selectedItemIds.size === 0}
            className="h-8 px-2.5 flex items-center gap-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" /> Copy selected…
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedItemIds.size === 0}
            className="h-8 px-2.5 flex items-center gap-1.5 text-[12px] font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete selected
          </button>
          <button
            onClick={() => setSelectedItemIds(new Set())}
            title="Clear selection"
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-3">
        {creators.length > 1 && (
          <div className="flex items-center gap-1.5 px-3.5 py-2 border-b border-slate-100 flex-wrap">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-0.5">Show:</span>
            <button
              onClick={() => setOwnerFilter('all')}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${ownerFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
            >
              All
            </button>
            {creators.map(([id, name]) => (
              <button
                key={id}
                onClick={() => setOwnerFilter(id)}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${ownerFilter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {visibleItems.length === 0 && (
            <div className="p-6 text-center text-[13px] text-slate-400">
              {items.length === 0 ? 'No exercises or notes yet.' : 'No items from this person.'}
            </div>
          )}
          {groupBySuperset(visibleItems).map(group => {
            if (!group.supersetId) {
              const item = group.members[0];
              return renderItemRow(item, visibleIndexById.get(item.id) ?? 0, false);
            }
            return (
              <div key={group.supersetId} className="bg-indigo-50/40">
                <div
                  draggable={canReorder}
                  onDragStart={() => handleDragStartGroup(group.members.map(m => m.id))}
                  onDragEnd={handleDragEndAny}
                  className="flex items-center gap-1.5 px-3.5 pt-2 pb-1 cursor-grab select-none"
                >
                  {canReorder && <GripVertical className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />}
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
                  {group.members.map(item => renderItemRow(item, visibleIndexById.get(item.id) ?? 0, true))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canEdit && !draft.id && (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          {renderForm()}
        </div>
      )}

      {showCopyModal && (
        <CopySessionModal
          items={items.filter(i => selectedItemIds.has(i.id))}
          exercises={exercises}
          sourceAthleteId={athleteId}
          sourceGroupId={session?.sourceGroupId ?? null}
          sourceDate={date}
          athletes={athletes}
          sessionGroups={sessionGroups}
          clubId={clubId}
          userId={userId}
          onClose={() => setShowCopyModal(false)}
        />
      )}
    </div>
  );
};
