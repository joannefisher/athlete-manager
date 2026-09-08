// components/gym/QuickSessionPlanner.tsx
// A lightweight, mobile/tablet-first way for S&C/Physio to throw together an
// impromptu session for one player: pick a player + date, then add rows to a
// single tabulated list — one row per exercise/conditioning/running/timer/
// note/section item, each showing its own relevant fields inline. Every row
// saves immediately (same gymApi.saveSessionItem path SessionEditor.tsx
// uses), so nothing is lost if the tab closes mid-session on a phone.
//
// Deliberately NOT SessionEditor.tsx with extra props: it's a separate,
// simpler component with its own page (see Gym.tsx's 'quick' page) because
// this is meant to be genuinely quick, not a stripped-down version of a
// screen carrying superset drag/drop, left/right split, "Mark as Primary",
// group-plan sync, copy-session, and inline exercise creation. This screen
// intentionally has none of that: exercises/conditioning/running items are
// picked from what's already in the bank (searchExercises/
// searchConditioningExercises/searchRunningExercises) and nothing here can
// create a new one — per the ask, this is a data-entry screen, not an
// exercise-bank-editing one. An unmatched search just says so.
//
// Native <input type="date"> is used for the date picker rather than
// GymUI2Root's custom stepper/popover — deliberately: it's genuinely better
// for the "on a phone, impromptu" scenario (a real native date UI on
// iOS/Android) and sidesteps that component's own still-open investigation
// entirely rather than depending on it.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity, Check, ChevronDown, Clock, Dumbbell, Edit2, Layers, Loader2,
  Plus, StickyNote, Timer as TimerIcon, Trash2, X,
} from 'lucide-react';
import type {
  GymAthlete as Athlete, GymConditioningExercise, GymExercise, GymExerciseGroupType,
  GymRunningExercise, GymSession, GymSessionItem, GymSessionItemDraft, GymSessionItemType,
} from './types';
import {
  fetchExerciseGroupTypes, fetchExercises, fetchConditioningExercises, fetchRunningExercises,
  fetchFrequentSectionNames, fetchAthleteSessionsForDateRange, getOrCreateSession, saveSessionItem,
  deleteSessionItem, searchExercises, searchConditioningExercises, searchRunningExercises, itemToDraft,
} from './gymApi';
import { itemDisplayName, itemMetaText } from './itemDisplay';
import { todayIso } from './WeekStrip';
import { useGymUndo } from './GymUndoContext';

const TYPE_TABS: { type: GymSessionItemType; label: string; Icon: any }[] = [
  { type: 'exercise', label: 'Exercise', Icon: Dumbbell },
  { type: 'conditioning', label: 'Conditioning', Icon: Activity },
  { type: 'running', label: 'Running', Icon: ChevronDown /* replaced below */ },
  { type: 'timer', label: 'Timer', Icon: TimerIcon },
  { type: 'note', label: 'Note', Icon: StickyNote },
  { type: 'section', label: 'Section', Icon: Layers },
];
// Running has no great single-glyph icon in the small lucide set already
// imported elsewhere in this module — reusing Clock (distance/pace association)
// rather than pulling in a new icon just for one tab.
TYPE_TABS[2] = { type: 'running', label: 'Running', Icon: Clock };

const TYPE_ICON: Record<GymSessionItemType, any> = Object.fromEntries(TYPE_TABS.map(t => [t.type, t.Icon])) as any;

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

export const QuickSessionPlanner = ({
  athletes,
  clubId,
  userId,
}: {
  athletes: Athlete[];
  clubId: string;
  userId: string;
}) => {
  const { pushUndo } = useGymUndo();

  const [athleteId, setAthleteId] = useState('');
  const [date, setDate] = useState(todayIso());

  const [loadingReference, setLoadingReference] = useState(true);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [exerciseGroupTypes, setExerciseGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [conditioningExercises, setConditioningExercises] = useState<GymConditioningExercise[]>([]);
  const [runningExercises, setRunningExercises] = useState<GymRunningExercise[]>([]);
  const [frequentSectionNames, setFrequentSectionNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingReference(true);
      try {
        const [exs, groups, condExs, runExs, sections] = await Promise.all([
          fetchExercises(clubId),
          fetchExerciseGroupTypes(clubId),
          fetchConditioningExercises(clubId),
          fetchRunningExercises(clubId),
          fetchFrequentSectionNames(clubId),
        ]);
        if (cancelled) return;
        setExercises(exs);
        setExerciseGroupTypes(groups);
        setConditioningExercises(condExs);
        setRunningExercises(runExs);
        setFrequentSectionNames(sections);
      } catch (err) {
        console.error('[QuickSessionPlanner] failed to load reference data', err);
      } finally {
        if (!cancelled) setLoadingReference(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubId]);

  const [loadingItems, setLoadingItems] = useState(false);
  const [session, setSession] = useState<GymSession | null>(null);
  const [items, setItems] = useState<GymSessionItem[]>([]);

  const loadItems = useCallback(async () => {
    if (!athleteId) { setSession(null); setItems([]); return; }
    setLoadingItems(true);
    try {
      const sessions = await fetchAthleteSessionsForDateRange(athleteId, [date]);
      const found = sessions[0] || null;
      setSession(found);
      setItems(found?.items || []);
    } catch (err) {
      console.error('[QuickSessionPlanner] failed to load session', err);
    } finally {
      setLoadingItems(false);
    }
  }, [athleteId, date]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const ensureSession = async (): Promise<GymSession> => {
    if (session) return session;
    const created = await getOrCreateSession(clubId, athleteId, date, userId);
    setSession(created);
    return created;
  };

  // ── Add/edit row form ────────────────────────────────────────────────
  const [draft, setDraft] = useState<GymSessionItemDraft>(emptyDraft);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exerciseQuery, setExerciseQuery] = useState('');
  const [conditioningQuery, setConditioningQuery] = useState('');
  const [runningQuery, setRunningQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);

  const exerciseInputRef = useRef<HTMLInputElement>(null);

  const setType = (t: GymSessionItemType) => {
    if (editingItemId) return; // don't let the type change mid-edit — cancel first
    setDraft(d => ({ ...emptyDraft, itemType: t }));
    setExerciseQuery(''); setConditioningQuery(''); setRunningQuery('');
    setShowPicker(false);
    setTimerMinutes(null); setTimerSeconds(null);
    setError(null);
  };

  const resetDraft = () => {
    setDraft(d => ({ ...emptyDraft, itemType: d.itemType })); // stay on the same tab — fastest for adding several of the same type in a row
    setEditingItemId(null);
    setExerciseQuery(''); setConditioningQuery(''); setRunningQuery('');
    setShowPicker(false);
    setTimerMinutes(null); setTimerSeconds(null);
    setError(null);
  };

  const startEdit = (item: GymSessionItem) => {
    const d = itemToDraft(item);
    setDraft(d);
    setEditingItemId(item.id);
    setError(null);
    setExerciseQuery(d.exerciseName || '');
    setConditioningQuery(d.conditioningExerciseName || '');
    setRunningQuery(d.runningExerciseName || '');
    setShowPicker(false);
    if (item.itemType === 'timer' && item.durationSeconds != null) {
      setTimerMinutes(Math.floor(item.durationSeconds / 60));
      setTimerSeconds(item.durationSeconds % 60);
    } else {
      setTimerMinutes(null); setTimerSeconds(null);
    }
  };

  const exerciseGroupIdForDraft = () => exercises.find(e => e.id === draft.exerciseId)?.exerciseGroupTypeId || null;

  const exerciseMatches = exerciseQuery.trim() ? searchExercises(exercises, exerciseQuery).slice(0, 8) : [];
  const conditioningMatches = conditioningQuery.trim() ? searchConditioningExercises(conditioningExercises, conditioningQuery).slice(0, 8) : [];
  const runningMatches = runningQuery.trim() ? searchRunningExercises(runningExercises, runningQuery).slice(0, 8) : [];

  const canSave = (() => {
    switch (draft.itemType) {
      case 'exercise': return !!draft.exerciseId;
      case 'conditioning': return !!draft.conditioningExerciseId;
      case 'running': return !!draft.runningExerciseId;
      case 'note': return !!draft.noteText?.trim();
      case 'timer': return !!draft.timerLabel?.trim() && draft.durationSeconds != null && draft.durationSeconds > 0;
      case 'section': return !!draft.sectionName?.trim();
      default: return false;
    }
  })();

  const handleSaveRow = async () => {
    if (!athleteId) { setError('Pick a player first.'); return; }
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const s = await ensureSession();
      const exerciseGroupId = draft.itemType === 'exercise' ? exerciseGroupIdForDraft() : null;
      const sortOrder = editingItemId
        ? items.find(i => i.id === editingItemId)?.sortOrder ?? items.length
        : items.length;
      const saved = await saveSessionItem(s.id, athleteId, { ...draft, id: editingItemId || undefined }, exerciseGroupId, sortOrder, userId);
      setItems(prev => (editingItemId ? prev.map(i => (i.id === saved.id ? saved : i)) : [...prev, saved]));
      if (!editingItemId) {
        const sessionId = s.id;
        pushUndo({
          label: `Remove "${itemDisplayName(saved)}"`,
          run: async () => {
            await deleteSessionItem(saved.id);
            setItems(prev => prev.filter(i => i.id !== saved.id));
          },
        });
      }
      resetDraft();
      if (draft.itemType === 'exercise') exerciseInputRef.current?.focus();
    } catch (err: any) {
      console.error('[QuickSessionPlanner] failed to save item', err);
      setError(err?.message || 'Failed to save — try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: GymSessionItem) => {
    const previous = item;
    setItems(prev => prev.filter(i => i.id !== item.id));
    if (editingItemId === item.id) resetDraft();
    try {
      await deleteSessionItem(item.id);
      pushUndo({
        label: `Restore "${itemDisplayName(previous)}"`,
        run: async () => {
          if (!session) return;
          const groupId = previous.itemType === 'exercise' ? exercises.find(e => e.id === previous.exerciseId)?.exerciseGroupTypeId || null : null;
          const restored = await saveSessionItem(session.id, athleteId, { ...itemToDraft(previous) }, groupId, previous.sortOrder, userId);
          setItems(prev => [...prev, restored].sort((a, b) => a.sortOrder - b.sortOrder));
        },
      });
    } catch (err) {
      console.error('[QuickSessionPlanner] failed to delete item', err);
      setItems(prev => [...prev, previous].sort((a, b) => a.sortOrder - b.sortOrder));
    }
  };

  const selectedAthlete = athletes.find(a => a.id === athleteId);
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="w-full max-w-2xl mx-auto p-4 md:p-6 space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <p className="text-[11px] text-slate-400 mb-3">Quick, impromptu session for one player — picks from the existing exercise bank only. For sections, supersets, or split left/right, use the full Sessions screen.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Player</label>
            <select
              value={athleteId}
              onChange={e => setAthleteId(e.target.value)}
              className="w-full h-10 px-3 text-[14px] rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a player…</option>
              {athletes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-10 px-3 text-[14px] rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {!athleteId ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-[13px] text-slate-400">
          Select a player to start building their session.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-slate-700">{selectedAthlete?.name} · {dateLabel}</span>
              {loadingItems && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
            </div>

            {items.length === 0 && !loadingItems ? (
              <div className="px-3 py-6 text-center text-[13px] text-slate-400">Nothing added yet — add the first item below.</div>
            ) : (
              <div>
                {items.map(item => {
                  const Icon = TYPE_ICON[item.itemType];
                  const meta = itemMetaText(item);
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-1 sm:grid-cols-[24px_1fr_auto] items-start sm:items-center gap-1 sm:gap-3 px-3 py-2.5 border-b border-slate-100 last:border-b-0 ${editingItemId === item.id ? 'bg-blue-50/60' : ''}`}
                    >
                      <Icon className="hidden sm:block w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 sm:hidden">
                          <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-[13px] font-medium text-slate-800 truncate">{itemDisplayName(item)}</span>
                        </div>
                        <span className="hidden sm:block text-[13px] font-medium text-slate-800 truncate">{itemDisplayName(item)}</span>
                        {meta && <p className="text-[11px] text-slate-400 mt-0.5">{meta}</p>}
                      </div>
                      <div className="flex items-center gap-1 justify-end sm:justify-self-end">
                        <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add / edit row */}
          <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-slate-100 rounded-md p-0.5 text-[12px] font-medium overflow-x-auto">
                {TYPE_TABS.map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    onClick={() => setType(type)}
                    disabled={!!editingItemId}
                    className={`px-2.5 py-1.5 rounded flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${draft.itemType === type ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                  >
                    <Icon className="w-3 h-3" />{label}
                  </button>
                ))}
              </div>
              {editingItemId && (
                <button onClick={resetDraft} className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1 shrink-0 ml-2">
                  <X className="w-3 h-3" />Cancel edit
                </button>
              )}
            </div>

            {loadingReference ? (
              <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 text-slate-300 animate-spin" /></div>
            ) : (
              <>
                {draft.itemType === 'exercise' && (
                  <div className="space-y-2">
                    <div className="relative">
                      {draft.exerciseId ? (
                        <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                            <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />{draft.exerciseName}
                          </span>
                          <button onClick={() => { setDraft(d => ({ ...d, exerciseId: null, exerciseName: undefined })); setExerciseQuery(''); setShowPicker(true); }} className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0">Change</button>
                        </div>
                      ) : (
                        <>
                          <input
                            ref={exerciseInputRef}
                            value={exerciseQuery}
                            onChange={e => { setExerciseQuery(e.target.value); setShowPicker(true); }}
                            onFocus={() => setShowPicker(true)}
                            placeholder="Search exercises…"
                            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          {showPicker && exerciseQuery.trim() && (
                            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                              {exerciseMatches.length === 0 ? (
                                <p className="px-3 py-2.5 text-[12px] text-slate-400">No match in the Exercise Bank — ask an Admin to add it there first.</p>
                              ) : exerciseMatches.map(ex => (
                                <button key={ex.id} onClick={() => { setDraft(d => ({ ...d, exerciseId: ex.id, exerciseName: ex.name })); setShowPicker(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between">
                                  <span>{ex.name}</span>
                                  <span className="text-[11px] text-slate-400">{ex.exerciseGroupTypeLabel}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                      <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                      <input type="number" min={0} placeholder="Load (kg)" value={draft.loadKg ?? ''} onChange={e => setDraft(d => ({ ...d, loadKg: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                    </div>
                  </div>
                )}

                {draft.itemType === 'conditioning' && (
                  <div className="space-y-2">
                    <div className="relative">
                      {draft.conditioningExerciseId ? (
                        <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                            <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />{draft.conditioningExerciseName}
                          </span>
                          <button onClick={() => { setDraft(d => ({ ...d, conditioningExerciseId: null, conditioningExerciseName: undefined })); setConditioningQuery(''); setShowPicker(true); }} className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0">Change</button>
                        </div>
                      ) : (
                        <>
                          <input
                            value={conditioningQuery}
                            onChange={e => { setConditioningQuery(e.target.value); setShowPicker(true); }}
                            onFocus={() => setShowPicker(true)}
                            placeholder="Search conditioning…"
                            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          {showPicker && conditioningQuery.trim() && (
                            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                              {conditioningMatches.length === 0 ? (
                                <p className="px-3 py-2.5 text-[12px] text-slate-400">No match — ask an Admin to add it to the conditioning list first.</p>
                              ) : conditioningMatches.map(ex => (
                                <button key={ex.id} onClick={() => { setDraft(d => ({ ...d, conditioningExerciseId: ex.id, conditioningExerciseName: ex.name })); setShowPicker(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50">{ex.name}</button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="number" min={0} placeholder="Sets" value={draft.sets ?? ''} onChange={e => setDraft(d => ({ ...d, sets: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                      <input type="number" min={0} placeholder="Reps" value={draft.reps ?? ''} onChange={e => setDraft(d => ({ ...d, reps: e.target.value ? Number(e.target.value) : null }))} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                    </div>
                  </div>
                )}

                {draft.itemType === 'running' && (
                  <div className="relative">
                    {draft.runningExerciseId ? (
                      <div className="flex items-center justify-between gap-2 h-9 px-3 border border-emerald-200 rounded-lg bg-emerald-50">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 truncate">
                          <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />{draft.runningExerciseName}
                          <span className="text-emerald-600 font-normal">{draft.runningExerciseDistanceMeters != null ? `· ${draft.runningExerciseDistanceMeters}m` : ''}</span>
                        </span>
                        <button onClick={() => { setDraft(d => ({ ...d, runningExerciseId: null, runningExerciseName: undefined, runningExerciseDistanceMeters: null })); setRunningQuery(''); setShowPicker(true); }} className="text-[11px] font-medium text-emerald-700 hover:underline flex-shrink-0">Change</button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={runningQuery}
                          onChange={e => { setRunningQuery(e.target.value); setShowPicker(true); }}
                          onFocus={() => setShowPicker(true)}
                          placeholder="Search running…"
                          className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {showPicker && runningQuery.trim() && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                            {runningMatches.length === 0 ? (
                              <p className="px-3 py-2.5 text-[12px] text-slate-400">No match — ask an Admin to add it to the running list first.</p>
                            ) : runningMatches.map(ex => (
                              <button key={ex.id} onClick={() => { setDraft(d => ({ ...d, runningExerciseId: ex.id, runningExerciseName: ex.name, runningExerciseDistanceMeters: ex.distanceMeters })); setShowPicker(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex justify-between">
                                <span>{ex.name}</span><span className="text-[11px] text-slate-400">{ex.distanceMeters}m</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {draft.itemType === 'timer' && (
                  <div className="space-y-2">
                    <input placeholder="Label, e.g. Rest between rounds" value={draft.timerLabel ?? ''} onChange={e => setDraft(d => ({ ...d, timerLabel: e.target.value || null }))} className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="number" min={0} placeholder="Minutes" value={timerMinutes ?? ''} onChange={e => {
                        const m = e.target.value ? Number(e.target.value) : null;
                        setTimerMinutes(m);
                        setDraft(d => ({ ...d, durationSeconds: (m ?? 0) * 60 + (timerSeconds ?? 0) }));
                      }} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                      <input type="number" min={0} max={59} placeholder="Seconds" value={timerSeconds ?? ''} onChange={e => {
                        const s = e.target.value ? Number(e.target.value) : null;
                        setTimerSeconds(s);
                        setDraft(d => ({ ...d, durationSeconds: (timerMinutes ?? 0) * 60 + (s ?? 0) }));
                      }} className="w-full h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                    </div>
                  </div>
                )}

                {draft.itemType === 'note' && (
                  <textarea placeholder="Note text…" value={draft.noteText ?? ''} onChange={e => setDraft(d => ({ ...d, noteText: e.target.value || null }))} rows={2} className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50 resize-none" />
                )}

                {draft.itemType === 'section' && (
                  <div className="space-y-1.5">
                    <input placeholder="Section name, e.g. Warm-up" value={draft.sectionName ?? ''} onChange={e => setDraft(d => ({ ...d, sectionName: e.target.value || null }))} className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50" />
                    {frequentSectionNames.length > 0 && !draft.sectionName && (
                      <div className="flex gap-1.5 flex-wrap">
                        {frequentSectionNames.map(name => (
                          <button key={name} onClick={() => setDraft(d => ({ ...d, sectionName: name }))} className="px-2 py-1 text-[11px] rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">{name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {error && <p className="text-[11px] text-red-600">{error}</p>}

                <button
                  onClick={handleSaveRow}
                  disabled={!canSave || saving}
                  className="w-full h-9 rounded-lg bg-slate-900 text-white text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editingItemId ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {editingItemId ? 'Save changes' : 'Add to session'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
