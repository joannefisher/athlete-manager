// components/gym/QuickSessionPlanner.tsx
// A lightweight, mobile/tablet-first way for S&C/Physio to throw together an
// impromptu session for one player. Two entry modes, switchable with the
// toggle at the top, both writing to the same item list below (every row
// still saves immediately — see gymApi.saveSessionItem):
//
//  - Table: an always-visible list of rows, the last one blank. Picking an
//    exercise/conditioning/running/section value commits that row straight
//    away (no separate "Add" button); any other field just autosaves when
//    you leave it. A blank row is what's left after that, ready for the
//    next item, focus following automatically — see QuickItemRow.tsx.
//  - Quick text: one line per item, typed shorthand ("Back Squat 3x8 80"),
//    Enter commits it and clears the box for the next line. No prefix means
//    exercise; cond:/run:/timer:/note:/# switch type — see
//    quickEntryParser.ts. Fastest for someone who already knows what they
//    want and would rather type than tap.
//
// 2026-09-08: replaces the previous single search-panel-then-Add-button
// design (too many taps per item, and a separate "edit" panel below the
// list) after direct feedback that it was still too slow for real use.
//
// Deliberately NOT SessionEditor.tsx with extra props: this stays a
// separate, simpler component with its own page (see Gym.tsx's 'quick'
// page) — no superset drag/drop, no left/right split, no "Mark as Primary",
// no group-plan sync, no copy-session, and — per the original ask — no way
// to create a new exercise/conditioning/running/section from this screen at
// all. Items are picked from what's already in the bank
// (searchExercises/searchConditioningExercises/searchRunningExercises) only;
// an unmatched name just says so, in both modes.
//
// Native <input type="date"> is used for the date picker rather than
// GymUI2Root's custom stepper/popover — deliberately: it's genuinely better
// for the "on a phone, impromptu" scenario and sidesteps that component's
// own still-open investigation entirely rather than depending on it.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { AlertCircle, Keyboard, Loader2, Table2 } from 'lucide-react';
import type {
  GymAthlete as Athlete, GymConditioningExercise, GymExercise, GymExerciseGroupType,
  GymRunningExercise, GymSession, GymSessionItem, GymSessionItemDraft, GymSessionItemType,
} from './types';
import {
  fetchExerciseGroupTypes, fetchExercises, fetchConditioningExercises, fetchRunningExercises,
  fetchFrequentSectionNames, fetchAthleteSessionsForDateRange, getOrCreateSession, saveSessionItem,
  deleteSessionItem, searchExercises, searchConditioningExercises, searchRunningExercises, itemToDraft,
} from './gymApi';
import { itemDisplayName } from './itemDisplay';
import { todayIso } from './WeekStrip';
import { useGymUndo } from './GymUndoContext';
import { QuickItemRow, type FocusRequest } from './QuickItemRow';
import { emptyDraft } from './quickSessionShared';
import { detectLineType, parseSetsRepsLoad, parseSetsReps, parseTimerShorthand } from './quickEntryParser';

type EntryMode = 'table' | 'text';

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
  const [mode, setMode] = useState<EntryMode>('table');

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
  const [savingRowId, setSavingRowId] = useState<string | null>(null); // 'new' or an item id

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

  const exerciseGroupIdFor = (exerciseId: string | null) => exercises.find(e => e.id === exerciseId)?.exerciseGroupTypeId || null;

  // ── new-row type (table mode) — carries over from the last item added, so adding several of the same type in a row needs no re-picking ──
  const [nextRowType, setNextRowType] = useState<GymSessionItemType>('exercise');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  // ── shared save path — used by both entry modes and by undo restores ────
  const createItem = async (draft: GymSessionItemDraft) => {
    if (!athleteId || savingRowId === 'new') return; // reentrancy guard — ignore a second commit while the first is still in flight
    setSavingRowId('new');
    try {
      const s = await ensureSession();
      const exerciseGroupId = draft.itemType === 'exercise' ? exerciseGroupIdFor(draft.exerciseId) : null;
      const saved = await saveSessionItem(s.id, athleteId, draft, exerciseGroupId, items.length, userId);
      setItems(prev => [...prev, saved]);
      pushUndo({
        label: `Remove "${itemDisplayName(saved)}"`,
        run: async () => {
          await deleteSessionItem(saved.id);
          setItems(prev => prev.filter(i => i.id !== saved.id));
        },
      });
      setNextRowType(draft.itemType);
      // Exercise/conditioning have more fields worth filling in right away —
      // send focus straight to Sets on the row that just appeared. Everything
      // else (running/timer/note/section, and quick-text mode) is already
      // complete, so just send focus back to the blank row for the next item.
      if (draft.itemType === 'exercise' || draft.itemType === 'conditioning') {
        setFocusRequest({ itemId: saved.id, field: 'sets' });
      } else if (mode === 'table') {
        setFocusRequest({ itemId: 'new', field: 'name' });
      }
    } catch (err) {
      console.error('[QuickSessionPlanner] failed to save item', err);
    } finally {
      setSavingRowId(null);
    }
  };

  const updateItemField = async (itemId: string, patch: Partial<GymSessionItemDraft>) => {
    const existing = items.find(i => i.id === itemId);
    if (!existing || !session) return;
    const nextDraft = { ...itemToDraft(existing), ...patch };
    setSavingRowId(itemId);
    // optimistic local update so typing feels instant
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, ...patch } as GymSessionItem : i)));
    try {
      const exerciseGroupId = nextDraft.itemType === 'exercise' ? exerciseGroupIdFor(nextDraft.exerciseId) : null;
      const saved = await saveSessionItem(session.id, athleteId, { ...nextDraft, id: itemId }, exerciseGroupId, existing.sortOrder, userId);
      setItems(prev => prev.map(i => (i.id === itemId ? saved : i)));
    } catch (err) {
      console.error('[QuickSessionPlanner] failed to update item', err);
      setItems(prev => prev.map(i => (i.id === itemId ? existing : i))); // revert on failure
    } finally {
      setSavingRowId(null);
    }
  };

  const handleDelete = async (item: GymSessionItem) => {
    const previous = item;
    setItems(prev => prev.filter(i => i.id !== item.id));
    try {
      await deleteSessionItem(item.id);
      pushUndo({
        label: `Restore "${itemDisplayName(previous)}"`,
        run: async () => {
          if (!session) return;
          const groupId = previous.itemType === 'exercise' ? exerciseGroupIdFor(previous.exerciseId) : null;
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
      ) : loadingReference ? (
        <div className="bg-white rounded-lg border border-slate-200 py-8 flex justify-center"><Loader2 className="w-4 h-4 text-slate-300 animate-spin" /></div>
      ) : (
        <>
          {/* Deliberately no overflow-hidden here (unlike the old single-panel layout): the type
              picker and exercise/conditioning/running search dropdowns are absolutely-positioned
              and open *below* their row, including the trailing blank row at the very bottom of
              this card — overflow-hidden clipped them clean off, which is what made the type
              toggle and the exercise search look broken (they were opening, just invisible and
              unclickable outside the card's bounds). rounded-t-lg on the header below keeps the
              top corners tidy without needing to clip the whole card. */}
          <div className="bg-white rounded-lg border border-slate-200">
            <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-lg flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-slate-700 truncate">{selectedAthlete?.name} · {dateLabel}</span>
              <div className="flex items-center gap-2 shrink-0">
                {loadingItems && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
                <div className="flex bg-slate-200/70 rounded-md p-0.5 text-[11px] font-medium">
                  <button onClick={() => setMode('table')} className={`px-2 py-1 rounded flex items-center gap-1 ${mode === 'table' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    <Table2 className="w-3 h-3" />Table
                  </button>
                  <button onClick={() => setMode('text')} className={`px-2 py-1 rounded flex items-center gap-1 ${mode === 'text' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    <Keyboard className="w-3 h-3" />Quick text
                  </button>
                </div>
              </div>
            </div>

            {items.length === 0 && !loadingItems && mode === 'text' && (
              <div className="px-3 py-4 text-center text-[13px] text-slate-400">Nothing added yet — type below to add the first item.</div>
            )}

            <div>
              {items.map(item => (
                <QuickItemRow
                  key={item.id}
                  item={item}
                  rowType={item.itemType}
                  exercises={exercises}
                  conditioningExercises={conditioningExercises}
                  runningExercises={runningExercises}
                  frequentSectionNames={frequentSectionNames}
                  saving={savingRowId === item.id}
                  focusRequest={focusRequest}
                  onFocused={() => setFocusRequest(null)}
                  onUpdateField={updateItemField}
                  onDelete={handleDelete}
                />
              ))}
              {mode === 'table' && (
                <QuickItemRow
                  key={`new-${items.length}-${nextRowType}`}
                  item={null}
                  rowType={nextRowType}
                  onTypeChange={setNextRowType}
                  exercises={exercises}
                  conditioningExercises={conditioningExercises}
                  runningExercises={runningExercises}
                  frequentSectionNames={frequentSectionNames}
                  saving={savingRowId === 'new'}
                  focusRequest={focusRequest}
                  onFocused={() => setFocusRequest(null)}
                  onCreate={createItem}
                />
              )}
            </div>
          </div>

          {mode === 'text' && (
            <QuickTextBar
              exercises={exercises}
              conditioningExercises={conditioningExercises}
              runningExercises={runningExercises}
              busy={savingRowId === 'new'}
              onCommit={createItem}
            />
          )}
        </>
      )}
    </div>
  );
};

// ── Quick text entry bar ────────────────────────────────────────────────
// One line in, one item out. No prefix -> exercise; cond:/run:/timer:/note:/#
// switch type (see quickEntryParser.ts). Enter commits and clears the line;
// arrow keys move the highlighted suggestion for bank-search types.

const TYPE_PLACEHOLDER = 'e.g. "Back Squat 3x8 80" · cond: Battle Ropes 5x30 · run: 400m Sprint · timer: Rest 90s · note: felt tired · #Warm-up';

const QuickTextBar = ({
  exercises,
  conditioningExercises,
  runningExercises,
  busy,
  onCommit,
}: {
  exercises: GymExercise[];
  conditioningExercises: GymConditioningExercise[];
  runningExercises: GymRunningExercise[];
  busy?: boolean;
  onCommit: (draft: GymSessionItemDraft) => void;
}) => {
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => detectLineType(text), [text]);

  const nameQuery = useMemo(() => {
    if (parsed.type === 'exercise') return parseSetsRepsLoad(parsed.rest).name;
    if (parsed.type === 'conditioning') return parseSetsReps(parsed.rest).name;
    if (parsed.type === 'running') return parsed.rest;
    return '';
  }, [parsed]);

  const suggestions = useMemo(() => {
    if (!nameQuery.trim()) return [];
    if (parsed.type === 'exercise') return searchExercises(exercises, nameQuery).slice(0, 6);
    if (parsed.type === 'conditioning') return searchConditioningExercises(conditioningExercises, nameQuery).slice(0, 6);
    if (parsed.type === 'running') return searchRunningExercises(runningExercises, nameQuery).slice(0, 6);
    return [];
  }, [parsed.type, nameQuery, exercises, conditioningExercises, runningExercises]);

  const isBankType = parsed.type === 'exercise' || parsed.type === 'conditioning' || parsed.type === 'running';

  // Commits a specific bank match directly — used both by Enter (with the
  // currently-highlighted suggestion) and by clicking a suggestion chip.
  // Kept as its own function, rather than reading `highlight` state inside
  // commitLine, because a chip click needs to commit whichever suggestion
  // was clicked, not whatever was highlighted before the click — those can
  // differ, and setHighlight()+commitLine() in the same handler would still
  // read the pre-click highlight value (state updates aren't synchronous).
  const commitPicked = (picked: GymExercise | GymConditioningExercise | GymRunningExercise) => {
    let draft: GymSessionItemDraft = { ...emptyDraft, itemType: parsed.type };
    if (parsed.type === 'exercise') {
      const { sets, reps, loadKg } = parseSetsRepsLoad(parsed.rest);
      draft = { ...draft, exerciseId: picked.id, exerciseName: (picked as GymExercise).name, sets, reps, loadKg };
    } else if (parsed.type === 'conditioning') {
      const { sets, reps } = parseSetsReps(parsed.rest);
      draft = { ...draft, conditioningExerciseId: picked.id, conditioningExerciseName: (picked as GymConditioningExercise).name, sets, reps };
    } else {
      const run = picked as GymRunningExercise;
      draft = { ...draft, runningExerciseId: run.id, runningExerciseName: run.name, runningExerciseDistanceMeters: run.distanceMeters };
    }
    onCommit(draft);
    setError(null);
    setText('');
    setHighlight(0);
  };

  const commitLine = () => {
    if (!text.trim()) return;
    setError(null);

    if (isBankType) {
      if (!nameQuery.trim()) { setError('Type a name to search for.'); return; }
      const picked = suggestions[Math.min(highlight, suggestions.length - 1)];
      if (!picked) { setError(`No match for "${nameQuery}" in the ${parsed.type} bank.`); return; }
      commitPicked(picked);
      return;
    }
    if (parsed.type === 'timer') {
      const { label, durationSeconds } = parseTimerShorthand(parsed.rest);
      if (!label || durationSeconds == null || durationSeconds <= 0) { setError('Give the timer a label and a duration, e.g. "timer: Rest 90s".'); return; }
      onCommit({ ...emptyDraft, itemType: 'timer', timerLabel: label, durationSeconds });
    } else if (parsed.type === 'note') {
      if (!parsed.rest.trim()) { setError('Type the note text after "note:".'); return; }
      onCommit({ ...emptyDraft, itemType: 'note', noteText: parsed.rest });
    } else if (parsed.type === 'section') {
      if (!parsed.rest.trim()) { setError('Type a section name, e.g. "#Warm-up".'); return; }
      onCommit({ ...emptyDraft, itemType: 'section', sectionName: parsed.rest });
    }
    setText('');
    setHighlight(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitLine(); }
    else if (isBankType && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
      <div className="relative">
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); setHighlight(0); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder={TYPE_PLACEHOLDER}
          disabled={busy}
          className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {busy && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {isBankType && text.trim() && suggestions.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { inputRef.current?.focus(); commitPicked(s); }}
              className={`px-2 py-1 text-[11px] rounded-full border ${i === highlight ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>
      )}
      <p className="text-[10.5px] text-slate-400">Press Enter to add and start the next line. No prefix = exercise.</p>
    </div>
  );
};
