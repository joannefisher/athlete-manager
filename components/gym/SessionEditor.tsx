// components/gym/SessionEditor.tsx
// Create/edit one athlete's Gym session for one date: an ordered list of
// exercise and note items (drag-and-drop reorder, edit, delete, optional
// left/right split), an exercise picker with type-ahead + inline "add new
// exercise", Sets/Reps/Load + Primary, the swapped-exercise indicator, an
// owner filter, and a "Copy session…" action. Every mutation here pushes an
// inverse action onto the shared undo stack (GymUndoContext) right after it
// succeeds. Reused both as the desktop split-pane's right column and as the
// full-screen mobile destination — see GymRoot.tsx.

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Check, Copy, Edit2, GripVertical, Loader2, Plus, RefreshCw, StickyNote, Trash2, X } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymExerciseGroup, GymSession, GymSessionGroup, GymSessionItem, GymSessionItemDraft } from './types';
import {
  fetchAthleteSessionsForDateRange,
  getOrCreateSession,
  saveSessionItem,
  deleteSessionItem,
  reorderSessionItems,
  createExercise,
  searchExercises,
} from './gymApi';
import { CopySessionModal } from './CopySessionModal';
import { useGymUndo } from './GymUndoContext';

const emptyDraft: GymSessionItemDraft = {
  itemType: 'exercise',
  exerciseId: null,
  sets: null,
  reps: null,
  load: null,
  isPrimary: false,
  side: 'both',
  noteText: null,
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
  exerciseGroups,
  exercises,
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
  exerciseGroups: GymExerciseGroup[];
  exercises: GymExercise[];
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
  const [newExerciseGroupId, setNewExerciseGroupId] = useState<string>('');
  const [splitSide, setSplitSide] = useState(false);
  const [rightDraft, setRightDraft] = useState<{ sets: number | null; reps: number | null; load: string | null }>({ sets: null, reps: null, load: null });

  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await fetchAthleteSessionsForDateRange(athleteId, [date]);
      const found = sessions[0] || null;
      setSession(found);
      setItems(found?.items || []);
    } catch (err) {
      console.error('[SessionEditor] failed to load session', err);
    } finally {
      setLoading(false);
    }
  }, [athleteId, date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOwnerFilter('all'); }, [athleteId, date]);

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
    setNewExerciseGroupId('');
    setSplitSide(false);
    setRightDraft({ sets: null, reps: null, load: null });
  };

  const matches = searchExercises(exercises, exerciseQuery);

  const handlePickExercise = (ex: GymExercise) => {
    setDraft(d => ({ ...d, exerciseId: ex.id, exerciseName: ex.name }));
    setExerciseQuery(ex.name);
    setShowPicker(false);
  };

  const handleCreateExercise = async () => {
    if (!exerciseQuery.trim() || !newExerciseGroupId) return;
    const created = await createExercise(clubId, exerciseQuery.trim(), newExerciseGroupId, userId);
    onExercisesChanged();
    setDraft(d => ({ ...d, exerciseId: created.id, exerciseName: created.name }));
    setAddingNewExercise(false);
    setShowPicker(false);
  };

  const handleStartEdit = (item: GymSessionItem) => {
    setDraft({
      id: item.id,
      itemType: item.itemType,
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      sets: item.sets,
      reps: item.reps,
      load: item.load,
      isPrimary: item.isPrimary,
      side: item.side,
      noteText: item.noteText,
    });
    setEditingSortOrder(item.sortOrder);
    setExerciseQuery(item.exerciseName || '');
    setShowPicker(false);
    setAddingNewExercise(false);
    setSplitSide(false);
  };

  const exerciseGroupIdForDraft = (d: GymSessionItemDraft) => exercises.find(e => e.id === d.exerciseId)?.exerciseGroupId || null;

  const handleAddItem = async () => {
    if (draft.itemType === 'exercise' && !draft.exerciseId) return;
    if (draft.itemType === 'note' && !draft.noteText?.trim()) return;
    setSaving(true);
    try {
      const s = await ensureSession();
      const exerciseGroupId = draft.itemType === 'exercise' ? exerciseGroupIdForDraft(draft) : null;

      if (!draft.id && draft.itemType === 'exercise' && splitSide) {
        // New split entry — save two independent items, Left then Right.
        const leftDraft: GymSessionItemDraft = { ...draft, side: 'left' };
        const rightDraftFull: GymSessionItemDraft = { ...draft, side: 'right', sets: rightDraft.sets, reps: rightDraft.reps, load: rightDraft.load };
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
          label: `Undo edit to "${previousItem.exerciseName || previousItem.noteText || 'item'}"`,
          run: async () => {
            const oldDraft: GymSessionItemDraft = {
              id: previousItem.id,
              itemType: previousItem.itemType,
              exerciseId: previousItem.exerciseId,
              sets: previousItem.sets,
              reps: previousItem.reps,
              load: previousItem.load,
              isPrimary: previousItem.isPrimary,
              side: previousItem.side,
              noteText: previousItem.noteText,
            };
            const restoredGroupId = previousItem.itemType === 'exercise' ? exerciseGroupIdForDraft(oldDraft) : null;
            const restored = await saveSessionItem(sessionId, athleteId, oldDraft, restoredGroupId, previousItem.sortOrder, userId);
            setItems(prev => prev.map(i => (i.id === restored.id ? restored : i)));
          },
        });
      } else if (!draft.id) {
        const sessionId = s.id;
        pushUndo({
          label: `Remove "${saved.exerciseName || saved.noteText || 'item'}"`,
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
        label: `Restore "${item.exerciseName || item.noteText || 'item'}"`,
        run: async () => {
          const oldDraft: GymSessionItemDraft = {
            itemType: item.itemType,
            exerciseId: item.exerciseId,
            sets: item.sets,
            reps: item.reps,
            load: item.load,
            isPrimary: item.isPrimary,
            side: item.side,
            noteText: item.noteText,
          };
          const restoredGroupId = item.itemType === 'exercise' ? exerciseGroupIdForDraft(oldDraft) : null;
          const restored = await saveSessionItem(sessionId, athleteId, oldDraft, restoredGroupId, item.sortOrder, userId);
          setItems(prev => [...prev, restored].sort((a, b) => a.sortOrder - b.sortOrder));
        },
      });
    }
  };

  const handleDrop = async (overId: string) => {
    const fromId = draggingId;
    setDraggingId(null);
    if (!fromId || fromId === overId) return;
    const fromIdx = items.findIndex(i => i.id === fromId);
    const toIdx = items.findIndex(i => i.id === overId);
    if (fromIdx === -1 || toIdx === -1) return;
    const prevItems = items;
    const prevOrder = items.map(it => ({ id: it.id, sortOrder: it.sortOrder }));
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setItems(reordered);
    try {
      await reorderSessionItems(reordered.map((it, idx) => ({ id: it.id, sortOrder: idx })));
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

  const creators = Array.from(
    new Map(items.filter(i => i.createdBy).map(i => [i.createdBy as string, i.createdByName || 'Unknown'])).entries()
  );
  const visibleItems = ownerFilter === 'all' ? items : items.filter(i => i.createdBy === ownerFilter);
  const canReorder = canEdit && ownerFilter === 'all';

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

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-900">{athlete?.name || 'Session'}</p>
          <p className="text-[12px] text-slate-400">{fmtDate(date)}</p>
        </div>
        {canEdit && items.length > 0 && (
          <button
            onClick={() => setShowCopyModal(true)}
            className="h-8 px-2.5 flex items-center gap-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" /> Copy session…
          </button>
        )}
      </div>

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
          {visibleItems.map((item, idx) => (
            <div
              key={item.id}
              draggable={canReorder}
              onDragStart={() => setDraggingId(item.id)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              onDragEnd={() => setDraggingId(null)}
              className={`px-3.5 py-3 flex items-start gap-2 ${draggingId === item.id ? 'opacity-40' : ''} ${draft.id === item.id ? 'bg-blue-50/60' : ''}`}
            >
              {canReorder && <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-1 flex-shrink-0 cursor-grab" />}
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                {item.itemType === 'exercise' ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-medium text-slate-800">{item.effectiveExerciseName || item.exerciseName}</span>
                      {item.side !== 'both' && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                          {sideLabel(item.side)}
                        </span>
                      )}
                      {item.isPrimary && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                          Primary
                        </span>
                      )}
                      {item.wasSwapped && (
                        <span
                          title={`Swapped from "${item.exerciseName}" to this player's default`}
                          className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200"
                        >
                          <RefreshCw className="w-2.5 h-2.5" /> swapped
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-slate-400 mt-0.5">
                      {[item.sets ? `${item.sets} sets` : null, item.reps ? `${item.reps} reps` : null, item.load ? `@ ${item.load}` : null]
                        .filter(Boolean)
                        .join(' × ') || 'No sets/reps/load set'}
                    </p>
                  </>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <StickyNote className="w-3.5 h-3.5 text-slate-300 mt-0.5 flex-shrink-0" />
                    <p className="text-[13px] text-slate-700">{item.noteText}</p>
                  </div>
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
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium w-fit">
              <button
                onClick={() => setDraft(d => ({ ...(draft.id ? d : emptyDraft), itemType: 'exercise' }))}
                disabled={!!draft.id}
                className={`px-2.5 py-1 rounded disabled:opacity-40 ${draft.itemType === 'exercise' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              >
                Exercise
              </button>
              <button
                onClick={() => setDraft(d => ({ ...(draft.id ? d : emptyDraft), itemType: 'note' }))}
                disabled={!!draft.id}
                className={`px-2.5 py-1 rounded disabled:opacity-40 ${draft.itemType === 'note' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              >
                Note
              </button>
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
                <input
                  value={exerciseQuery}
                  onChange={e => {
                    setExerciseQuery(e.target.value);
                    setDraft(d => ({ ...d, exerciseId: null }));
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
                        <span className="text-[11px] text-slate-400">{ex.exerciseGroupName}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => setAddingNewExercise(true)}
                      className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add "{exerciseQuery.trim()}" as new exercise
                    </button>
                  </div>
                )}
              </div>

              {addingNewExercise && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <label className="block text-[11px] font-medium text-slate-500">Exercise group</label>
                  <select
                    value={newExerciseGroupId}
                    onChange={e => setNewExerciseGroupId(e.target.value)}
                    className="w-full h-8 px-2 text-[13px] border border-slate-200 rounded bg-white"
                  >
                    <option value="">Select a group…</option>
                    {exerciseGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}{g.typeName ? ` (${g.typeName})` : ''}</option>
                    ))}
                  </select>
                  {exerciseGroups.length === 0 && (
                    <p className="text-[11px] text-amber-600">No exercise groups yet — add one in Setup → Gym first.</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={handleCreateExercise} disabled={!newExerciseGroupId} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40">
                      Create exercise
                    </button>
                    <button onClick={() => setAddingNewExercise(false)} className="h-8 px-3 text-[12px] text-slate-500">Cancel</button>
                  </div>
                </div>
              )}

              {!draft.id && (
                <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={splitSide} onChange={e => setSplitSide(e.target.checked)} className="w-3.5 h-3.5" />
                  Split left / right
                  <span className="text-slate-400">— separate sets/reps/load for each side</span>
                </label>
              )}

              {splitSide && !draft.id ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-500">Left</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                      <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                      <input placeholder="Load" value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-500">Right</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="number" min={0} placeholder="Sets" value={rightDraft.sets ?? ''} onChange={e => setRightDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                      <input type="number" min={0} placeholder="Reps" value={rightDraft.reps ?? ''} onChange={e => setRightDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                      <input placeholder="Load" value={rightDraft.load ?? ''} onChange={e => setRightDraft(d => ({ ...d, load: e.target.value || null }))}
                        className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                    </div>
                  </div>
                </div>
              ) : (
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
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Load</label>
                    <input value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 60kg"
                      className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={draft.isPrimary} onChange={e => setDraft(d => ({ ...d, isPrimary: e.target.checked }))} className="w-3.5 h-3.5" />
                Mark as Primary
                <span className="text-slate-400">— may be swapped to the player's own default for this exercise's group</span>
              </label>
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
              disabled={saving || (draft.itemType === 'exercise' ? !draft.exerciseId : !draft.noteText?.trim())}
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
        </div>
      )}

      {showCopyModal && (
        <CopySessionModal
          items={items}
          exercises={exercises}
          sourceAthleteId={athleteId}
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
