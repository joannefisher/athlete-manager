// components/gym/GroupSessionEditor.tsx
// Bulk build/edit a session for a whole gym group on one date: an add-item
// form (same shape as SessionEditor's) applies to every member's session at
// once — each member's session is created if needed and the swap-primary
// rule still resolves per-athlete. Below it, a per-member breakdown with a
// link into that athlete's own SessionEditor for fine-grained edits/deletes
// without touching the rest of the group.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, Check, ChevronRight, Link2, Loader2, Plus, Trash2, Users } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymExerciseGroup, GymSessionGroup, GymSessionItem, GymSessionItemDraft } from './types';
import { addItemToGroupSession, createExercise, deleteSessionItem, fetchSessionsForDateRange, searchExercises, setSessionItemsSuperset } from './gymApi';
import { newSupersetId } from './supersetDnd';
import { useGymUndo } from './GymUndoContext';

/** One exercise slot while building a Superset for the whole group in one go — see handleAddSupersetToGroup. */
interface SupersetSlot {
  exerciseId: string | null;
  exerciseName: string;
  query: string;
  showPicker: boolean;
  sets: number | null;
  reps: number | null;
  load: string | null;
  isPrimary: boolean;
}

const emptySlot = (): SupersetSlot => ({ exerciseId: null, exerciseName: '', query: '', showPicker: false, sets: null, reps: null, load: null, isPrimary: false });

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

export const GroupSessionEditor = ({
  group,
  date,
  clubId,
  userId,
  athletes,
  exerciseGroups,
  exercises,
  onExercisesChanged,
  onEditIndividual,
  onBack,
}: {
  group: GymSessionGroup;
  date: string;
  clubId: string;
  userId: string;
  athletes: Athlete[];
  exerciseGroups: GymExerciseGroup[];
  exercises: GymExercise[];
  onExercisesChanged: () => void;
  onEditIndividual: (athleteId: string, date: string) => void;
  onBack: () => void;
}) => {
  const { pushUndo } = useGymUndo();
  const members = athletes.filter(a => group.memberAthleteIds.includes(a.id));
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const [draft, setDraft] = useState<GymSessionItemDraft>(emptyDraft);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [addingNewExercise, setAddingNewExercise] = useState(false);
  const [newExerciseGroupId, setNewExerciseGroupId] = useState('');
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [createExerciseError, setCreateExerciseError] = useState<string | null>(null);
  const [splitSide, setSplitSide] = useState(false);
  const [rightDraft, setRightDraft] = useState<{ sets: number | null; reps: number | null; load: string | null }>({ sets: null, reps: null, load: null });

  // Building a Superset (2+ exercises, done together in a fixed order) to add
  // to everyone's session at once — see handleAddSupersetToGroup. Each
  // member gets their own independent items, just sharing one grouping key.
  const [buildingSuperset, setBuildingSuperset] = useState(false);
  const [supersetSlots, setSupersetSlots] = useState<SupersetSlot[]>([emptySlot(), emptySlot()]);

  // Focus jumps straight to Sets right after an exercise is picked/created,
  // in both the main add-form and (indexed) each Superset slot.
  const setsInputRef = useRef<HTMLInputElement>(null);
  const slotSetsInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await fetchSessionsForDateRange(clubId, [date]);
      const counts: Record<string, number> = {};
      for (const m of members) counts[m.id] = 0;
      for (const s of sessions) {
        if (group.memberAthleteIds.includes(s.athleteId)) counts[s.athleteId] = s.items?.length ?? 0;
      }
      setItemCounts(counts);
    } catch (err) {
      console.error('[GroupSessionEditor] failed to load session counts', err);
    } finally {
      setLoading(false);
    }
  }, [clubId, date, group.id]);

  useEffect(() => { load(); }, [load]);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setExerciseQuery('');
    setShowPicker(false);
    setAddingNewExercise(false);
    setNewExerciseGroupId('');
    setSplitSide(false);
    setRightDraft({ sets: null, reps: null, load: null });
    setBuildingSuperset(false);
    setSupersetSlots([emptySlot(), emptySlot()]);
  };

  const updateSlot = (index: number, patch: Partial<SupersetSlot>) => {
    setSupersetSlots(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const pickSlotExercise = (index: number, ex: GymExercise) => {
    updateSlot(index, { exerciseId: ex.id, exerciseName: ex.name, query: ex.name, showPicker: false });
    setTimeout(() => slotSetsInputRefs.current[index]?.focus(), 0);
  };
  const addSlot = () => setSupersetSlots(prev => (prev.length >= 6 ? prev : [...prev, emptySlot()]));
  const removeSlot = (index: number) => setSupersetSlots(prev => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));

  const matches = searchExercises(exercises, exerciseQuery);

  const handlePickExercise = (ex: GymExercise) => {
    setDraft(d => ({ ...d, exerciseId: ex.id, exerciseName: ex.name }));
    setExerciseQuery(ex.name);
    setShowPicker(false);
    setTimeout(() => setsInputRef.current?.focus(), 0);
  };

  const handleCreateExercise = async () => {
    if (!exerciseQuery.trim() || !newExerciseGroupId) return;
    setCreatingExercise(true);
    setCreateExerciseError(null);
    try {
      const created = await createExercise(clubId, exerciseQuery.trim(), newExerciseGroupId, userId);
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

  const handleAddToGroup = async () => {
    if (draft.itemType === 'exercise' && !draft.exerciseId) return;
    if (draft.itemType === 'note' && !draft.noteText?.trim()) return;
    if (members.length === 0) return;
    setSaving(true);
    try {
      const exerciseGroupId =
        draft.itemType === 'exercise' ? exercises.find(e => e.id === draft.exerciseId)?.exerciseGroupId || null : null;

      let created: GymSessionItem[];
      if (draft.itemType === 'exercise' && splitSide) {
        const leftDraft: GymSessionItemDraft = { ...draft, side: 'left' };
        const rightDraftFull: GymSessionItemDraft = { ...draft, side: 'right', sets: rightDraft.sets, reps: rightDraft.reps, load: rightDraft.load };
        // Sequential, not parallel — each call reads every member's current item count to
        // pick a sort_order, so running Left and Right concurrently could race on that count.
        const createdLeft = await addItemToGroupSession(clubId, group.id, group.memberAthleteIds, date, leftDraft, exerciseGroupId, userId);
        const createdRight = await addItemToGroupSession(clubId, group.id, group.memberAthleteIds, date, rightDraftFull, exerciseGroupId, userId);
        created = [...createdLeft, ...createdRight];
      } else {
        created = await addItemToGroupSession(clubId, group.id, group.memberAthleteIds, date, draft, exerciseGroupId, userId);
      }

      setAddedCount(c => c + created.length);
      pushUndo({
        label: `Remove "${draft.exerciseName || draft.noteText || 'item'}" from ${group.name}`,
        run: async () => {
          for (const item of created) await deleteSessionItem(item.id);
          await load();
        },
      });
      resetDraft();
      await load();
    } catch (err: any) {
      console.error('[GroupSessionEditor] failed to add group item', err);
      window.alert(err?.message || 'Failed to add to group session.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Add a whole Superset (2+ exercises, always done together in this order)
   * to every member's session at once. Each exercise is added in turn via
   * the same addItemToGroupSession() the single-exercise flow uses — kept
   * sequential (not parallel) for the same sort_order-race reason the
   * existing split-side add already is — and every item created across
   * every member and every slot is then tagged with one shared supersetId.
   */
  const handleAddSupersetToGroup = async () => {
    if (members.length === 0) return;
    if (supersetSlots.some(s => !s.exerciseId)) return;
    setSaving(true);
    try {
      const supersetId = newSupersetId();
      const allCreatedIds: string[] = [];
      let totalCreated = 0;
      for (const slot of supersetSlots) {
        const exerciseGroupId = exercises.find(e => e.id === slot.exerciseId)?.exerciseGroupId || null;
        const slotDraft: GymSessionItemDraft = {
          itemType: 'exercise',
          exerciseId: slot.exerciseId,
          exerciseName: slot.exerciseName,
          sets: slot.sets,
          reps: slot.reps,
          load: slot.load,
          isPrimary: slot.isPrimary,
          side: 'both',
          noteText: null,
        };
        const created = await addItemToGroupSession(clubId, group.id, group.memberAthleteIds, date, slotDraft, exerciseGroupId, userId);
        allCreatedIds.push(...created.map(i => i.id));
        totalCreated += created.length;
      }
      await setSessionItemsSuperset(allCreatedIds, supersetId);

      setAddedCount(c => c + totalCreated);
      pushUndo({
        label: `Remove superset from ${group.name}`,
        run: async () => {
          for (const id of allCreatedIds) await deleteSessionItem(id);
          await load();
        },
      });
      resetDraft();
      await load();
    } catch (err: any) {
      console.error('[GroupSessionEditor] failed to add superset', err);
      window.alert(err?.message || 'Failed to add this superset to the group session.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3">
        <p className="text-[15px] font-bold text-slate-900 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-slate-400" /> {group.name}
        </p>
        <p className="text-[12px] text-slate-400">{fmtDate(date)} · {members.length} player{members.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3.5 mb-3">
        <p className="text-[12px] font-semibold text-slate-600 mb-2.5">Add to everyone's session</p>
        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium mb-3 w-fit">
          <button onClick={() => setDraft(d => ({ ...emptyDraft, itemType: 'exercise' }))} className={`px-2.5 py-1 rounded ${draft.itemType === 'exercise' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            Exercise
          </button>
          <button onClick={() => setDraft(d => ({ ...emptyDraft, itemType: 'note' }))} className={`px-2.5 py-1 rounded ${draft.itemType === 'note' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            Note
          </button>
        </div>

        {draft.itemType === 'exercise' && (
          <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer mb-2.5">
            <input
              type="checkbox"
              checked={buildingSuperset}
              onChange={e => { setBuildingSuperset(e.target.checked); setSplitSide(false); }}
              className="w-3.5 h-3.5"
            />
            <Link2 className="w-3 h-3 text-indigo-500" />
            Build a superset
            <span className="text-slate-400">— 2+ exercises done together, in order, for every player</span>
          </label>
        )}

        {draft.itemType === 'exercise' && buildingSuperset ? (
          <div className="space-y-3">
            {supersetSlots.map((slot, i) => {
              const slotMatches = searchExercises(exercises, slot.query);
              return (
                <div key={i} className="p-2.5 rounded-lg bg-indigo-50/40 border border-indigo-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">Exercise {i + 1}</span>
                    {supersetSlots.length > 2 && (
                      <button onClick={() => removeSlot(i)} className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    {slot.exerciseId ? (
                      <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                          <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          {slot.exerciseName}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateSlot(i, { exerciseId: null, exerciseName: '', query: '', showPicker: true })}
                          className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={slot.query}
                          onChange={e => updateSlot(i, { query: e.target.value, showPicker: true })}
                          onFocus={() => updateSlot(i, { showPicker: true })}
                          placeholder="Start typing…"
                          className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {slot.showPicker && slot.query.trim() && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                            {slotMatches.map(ex => (
                              <button
                                key={ex.id}
                                onClick={() => pickSlotExercise(i, ex)}
                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between"
                              >
                                <span>{ex.name}</span>
                                <span className="text-[11px] text-slate-400">{ex.exerciseGroupName}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input ref={el => { slotSetsInputRefs.current[i] = el; }} type="number" min={0} placeholder="Sets" value={slot.sets ?? ''} onChange={e => updateSlot(i, { sets: e.target.value ? Number(e.target.value) : null })}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-white" />
                    <input type="number" min={0} placeholder="Reps" value={slot.reps ?? ''} onChange={e => updateSlot(i, { reps: e.target.value ? Number(e.target.value) : null })}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-white" />
                    <input placeholder="Intensity" value={slot.load ?? ''} onChange={e => updateSlot(i, { load: e.target.value || null })}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-white" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={slot.isPrimary} onChange={e => updateSlot(i, { isPrimary: e.target.checked })} className="w-3.5 h-3.5" />
                    Mark as Primary
                  </label>
                </div>
              );
            })}
            {supersetSlots.length < 6 && (
              <button onClick={addSlot} className="w-full h-8 flex items-center justify-center gap-1 text-[12px] font-medium text-indigo-600 border border-dashed border-indigo-300 rounded-lg hover:bg-indigo-50">
                <Plus className="w-3.5 h-3.5" /> Add another exercise to this superset
              </button>
            )}
          </div>
        ) : draft.itemType === 'exercise' ? (
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
                          <span className="text-[11px] text-slate-400">{ex.exerciseGroupName}</span>
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
                <label className="block text-[11px] font-medium text-slate-500">Exercise group</label>
                <select value={newExerciseGroupId} onChange={e => setNewExerciseGroupId(e.target.value)} className="w-full h-8 px-2 text-[13px] border border-slate-200 rounded bg-white">
                  <option value="">Select a group…</option>
                  {exerciseGroups.map(g => <option key={g.id} value={g.id}>{g.name}{g.typeName ? ` (${g.typeName})` : ''}</option>)}
                </select>
                {createExerciseError && (
                  <p className="text-[11px] text-red-600">{createExerciseError}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={handleCreateExercise} disabled={!newExerciseGroupId || creatingExercise} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                    {creatingExercise && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {creatingExercise ? 'Creating…' : 'Create exercise'}
                  </button>
                  <button onClick={() => { setAddingNewExercise(false); setCreateExerciseError(null); }} disabled={creatingExercise} className="h-8 px-3 text-[12px] text-slate-500 disabled:opacity-40">Cancel</button>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={splitSide} onChange={e => setSplitSide(e.target.checked)} className="w-3.5 h-3.5" />
              Split left / right
              <span className="text-slate-400">— separate sets/reps/intensity for each side</span>
            </label>

            {splitSide ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500">Left</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input ref={setsInputRef} type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                    <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
                    <input placeholder="Intensity" value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))}
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
                    <input placeholder="Intensity" value={rightDraft.load ?? ''} onChange={e => setRightDraft(d => ({ ...d, load: e.target.value || null }))}
                      className="w-full h-8 px-1.5 text-[12px] border border-slate-200 rounded bg-slate-50" />
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
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Intensity</label>
                  <input value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 60kg" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={draft.isPrimary} onChange={e => setDraft(d => ({ ...d, isPrimary: e.target.checked }))} className="w-3.5 h-3.5" />
              Mark as Primary
              <span className="text-slate-400">— each player's own default may apply instead of what's picked here</span>
            </label>
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

        <button
          onClick={draft.itemType === 'exercise' && buildingSuperset ? handleAddSupersetToGroup : handleAddToGroup}
          disabled={
            saving ||
            members.length === 0 ||
            (draft.itemType === 'exercise' && buildingSuperset
              ? supersetSlots.some(s => !s.exerciseId)
              : draft.itemType === 'exercise'
              ? !draft.exerciseId
              : !draft.noteText?.trim())
          }
          className="mt-3 w-full h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {draft.itemType === 'exercise' && buildingSuperset
            ? `Add superset to all ${members.length} sessions`
            : splitSide
            ? `Add both sides to all ${members.length} sessions`
            : `Add to all ${members.length} sessions`}
        </button>
        {addedCount > 0 && <p className="text-[11px] text-green-600 mt-2">Added {addedCount} item{addedCount !== 1 ? 's' : ''} to this group's sessions so far.</p>}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        <div className="px-3.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Per-player breakdown</div>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
        ) : (
          members.map(m => (
            <button key={m.id} onClick={() => onEditIndividual(m.id, date)} className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50 text-left">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-semibold text-slate-500 flex-shrink-0">{m.avatar}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-slate-800 truncate">{m.name}</p>
                <p className="text-[11px] text-slate-400">{itemCounts[m.id] ?? 0} item{(itemCounts[m.id] ?? 0) !== 1 ? 's' : ''}</p>
              </div>
              <span className="text-[11px] text-blue-600">Edit individually</span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          ))
        )}
        {!loading && members.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">This group has no players yet.</div>}
      </div>
    </div>
  );
};
