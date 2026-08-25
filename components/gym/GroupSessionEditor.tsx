// components/gym/GroupSessionEditor.tsx
// Bulk build/edit a session for a whole gym group on one date: an add-item
// form (same shape as SessionEditor's) applies to every member's session at
// once — each member's session is created if needed and the swap-primary
// rule still resolves per-athlete. Below it, a per-member breakdown with a
// link into that athlete's own SessionEditor for fine-grained edits/deletes
// without touching the rest of the group.

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Check, ChevronRight, Loader2, Plus, Users } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymExerciseGroup, GymSessionGroup, GymSessionItemDraft } from './types';
import { addItemToGroupSession, createExercise, fetchSessionsForDateRange, searchExercises } from './gymApi';

const emptyDraft: GymSessionItemDraft = {
  itemType: 'exercise',
  exerciseId: null,
  sets: null,
  reps: null,
  load: null,
  isPrimary: false,
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
  };

  const matches = searchExercises(exercises, exerciseQuery);

  const handleCreateExercise = async () => {
    if (!exerciseQuery.trim() || !newExerciseGroupId) return;
    const created = await createExercise(clubId, exerciseQuery.trim(), newExerciseGroupId, userId);
    onExercisesChanged();
    setDraft(d => ({ ...d, exerciseId: created.id, exerciseName: created.name }));
    setAddingNewExercise(false);
    setShowPicker(false);
  };

  const handleAddToGroup = async () => {
    if (draft.itemType === 'exercise' && !draft.exerciseId) return;
    if (draft.itemType === 'note' && !draft.noteText?.trim()) return;
    if (members.length === 0) return;
    setSaving(true);
    try {
      const exerciseGroupId =
        draft.itemType === 'exercise' ? exercises.find(e => e.id === draft.exerciseId)?.exerciseGroupId || null : null;
      await addItemToGroupSession(clubId, group.id, group.memberAthleteIds, date, draft, exerciseGroupId, userId);
      setAddedCount(c => c + 1);
      resetDraft();
      await load();
    } catch (err: any) {
      console.error('[GroupSessionEditor] failed to add group item', err);
      window.alert(err?.message || 'Failed to add to group session.');
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

        {draft.itemType === 'exercise' ? (
          <div className="space-y-2.5">
            <div className="relative">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Exercise</label>
              <input
                value={exerciseQuery}
                onChange={e => { setExerciseQuery(e.target.value); setDraft(d => ({ ...d, exerciseId: null })); setShowPicker(true); }}
                onFocus={() => setShowPicker(true)}
                placeholder="Start typing…"
                className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {showPicker && exerciseQuery.trim() && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                  {matches.map(ex => (
                    <button key={ex.id} onClick={() => { setDraft(d => ({ ...d, exerciseId: ex.id, exerciseName: ex.name })); setExerciseQuery(ex.name); setShowPicker(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between">
                      <span>{ex.name}</span>
                      <span className="text-[11px] text-slate-400">{ex.exerciseGroupName}</span>
                    </button>
                  ))}
                  <button onClick={() => setAddingNewExercise(true)} className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t border-slate-100">
                    <Plus className="w-3.5 h-3.5" /> Add "{exerciseQuery.trim()}" as new exercise
                  </button>
                </div>
              )}
            </div>

            {addingNewExercise && (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <label className="block text-[11px] font-medium text-slate-500">Exercise group</label>
                <select value={newExerciseGroupId} onChange={e => setNewExerciseGroupId(e.target.value)} className="w-full h-8 px-2 text-[13px] border border-slate-200 rounded bg-white">
                  <option value="">Select a group…</option>
                  {exerciseGroups.map(g => <option key={g.id} value={g.id}>{g.name}{g.typeName ? ` (${g.typeName})` : ''}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleCreateExercise} disabled={!newExerciseGroupId} className="h-8 px-3 text-[12px] font-medium bg-slate-900 text-white rounded disabled:opacity-40">Create exercise</button>
                  <button onClick={() => setAddingNewExercise(false)} className="h-8 px-3 text-[12px] text-slate-500">Cancel</button>
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
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Load</label>
                <input value={draft.load ?? ''} onChange={e => setDraft(d => ({ ...d, load: e.target.value || null }))} placeholder="e.g. 60kg" className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

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
          onClick={handleAddToGroup}
          disabled={saving || members.length === 0 || (draft.itemType === 'exercise' ? !draft.exerciseId : !draft.noteText?.trim())}
          className="mt-3 w-full h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Add to all {members.length} sessions
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
