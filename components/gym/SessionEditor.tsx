// components/gym/SessionEditor.tsx
// Create/edit one athlete's Gym session for one date: an ordered list of
// exercise and note items, an exercise picker with type-ahead + inline
// "add new exercise", Sets/Reps/Load + Primary, and the swapped-exercise
// indicator produced by the default-primary rule.

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Check, Loader2, Plus, RefreshCw, StickyNote, Trash2 } from 'lucide-react';
import type { Athlete } from '../AthleteManager';
import type { GymExercise, GymExerciseGroup, GymSession, GymSessionItem, GymSessionItemDraft } from './types';
import {
  fetchAthleteSessionsForDateRange,
  getOrCreateSession,
  saveSessionItem,
  deleteSessionItem,
  createExercise,
  searchExercises,
} from './gymApi';

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

export const SessionEditor = ({
  athlete,
  athleteId,
  date,
  clubId,
  userId,
  canEdit,
  exerciseGroups,
  exercises,
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
  onExercisesChanged: () => void;
  onBack: () => void;
}) => {
  const [session, setSession] = useState<GymSession | null>(null);
  const [items, setItems] = useState<GymSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<GymSessionItemDraft>(emptyDraft);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [addingNewExercise, setAddingNewExercise] = useState(false);
  const [newExerciseGroupId, setNewExerciseGroupId] = useState<string>('');

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

  const ensureSession = async (): Promise<GymSession> => {
    if (session) return session;
    const created = await getOrCreateSession(clubId, athleteId, date, userId);
    setSession(created);
    return created;
  };

  const resetDraft = () => {
    setDraft(emptyDraft);
    setExerciseQuery('');
    setShowPicker(false);
    setAddingNewExercise(false);
    setNewExerciseGroupId('');
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

  const handleAddItem = async () => {
    if (draft.itemType === 'exercise' && !draft.exerciseId) return;
    if (draft.itemType === 'note' && !draft.noteText?.trim()) return;
    setSaving(true);
    try {
      const s = await ensureSession();
      const exerciseGroupId =
        draft.itemType === 'exercise' ? exercises.find(e => e.id === draft.exerciseId)?.exerciseGroupId || null : null;
      const saved = await saveSessionItem(s.id, athleteId, draft, exerciseGroupId, items.length, userId);
      setItems(prev => [...prev, saved]);
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
    await deleteSessionItem(itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3">
        <p className="text-[15px] font-bold text-slate-900">{athlete?.name || 'Session'}</p>
        <p className="text-[12px] text-slate-400">{fmtDate(date)}</p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-3">
        {items.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">No exercises or notes yet.</div>}
        {items.map((item, idx) => (
          <div key={item.id} className="px-3.5 py-3 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              {item.itemType === 'exercise' ? (
                <>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-medium text-slate-800">{item.effectiveExerciseName || item.exerciseName}</span>
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
              <button onClick={() => handleDeleteItem(item.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium mb-3 w-fit">
            <button
              onClick={() => setDraft(d => ({ ...emptyDraft, itemType: 'exercise' }))}
              className={`px-2.5 py-1 rounded ${draft.itemType === 'exercise' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            >
              Exercise
            </button>
            <button
              onClick={() => setDraft(d => ({ ...emptyDraft, itemType: 'note' }))}
              className={`px-2.5 py-1 rounded ${draft.itemType === 'note' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            >
              Note
            </button>
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

          <button
            onClick={handleAddItem}
            disabled={saving || (draft.itemType === 'exercise' ? !draft.exerciseId : !draft.noteText?.trim())}
            className="mt-3 w-full h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Add to session
          </button>
        </div>
      )}
    </div>
  );
};
