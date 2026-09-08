// components/gym/QuickItemRow.tsx
// One row of QuickSessionPlanner's item table — used for BOTH an already
// saved item (`item` set, fields editable in place, autosaving per field on
// blur/Enter) AND the trailing blank "add new" row (`item` null). There is
// deliberately no separate "edit panel" and no "Add to session" button:
// picking an exercise/conditioning/running/section value commits the row
// immediately (that's the one truly required field), and any other field
// just autosaves when you leave it. This is what replaces the old
// search-box -> dropdown -> fill fields -> tap Add flow.

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Trash2 } from 'lucide-react';
import type {
  GymConditioningExercise, GymExercise, GymRunningExercise,
  GymSessionItem, GymSessionItemDraft, GymSessionItemType,
} from './types';
import { searchExercises, searchConditioningExercises, searchRunningExercises, itemToDraft } from './gymApi';
import { TYPE_TABS, TYPE_ICON, emptyDraft } from './quickSessionShared';

const fieldClass = 'h-9 px-2 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white';

export interface FocusRequest {
  itemId: string | 'new';
  field: string;
}

export const QuickItemRow = ({
  item,
  rowType,
  onTypeChange,
  exercises,
  conditioningExercises,
  runningExercises,
  frequentSectionNames,
  saving,
  focusRequest,
  onFocused,
  onCreate,
  onUpdateField,
  onDelete,
}: {
  item: GymSessionItem | null;
  rowType: GymSessionItemType;
  onTypeChange?: (t: GymSessionItemType) => void;
  exercises: GymExercise[];
  conditioningExercises: GymConditioningExercise[];
  runningExercises: GymRunningExercise[];
  frequentSectionNames: string[];
  saving?: boolean;
  focusRequest?: FocusRequest | null;
  onFocused?: () => void;
  onCreate?: (draft: GymSessionItemDraft) => void;
  onUpdateField?: (itemId: string, patch: Partial<GymSessionItemDraft>) => void;
  onDelete?: (item: GymSessionItem) => void;
}) => {
  const isNew = !item;
  const [draft, setDraft] = useState<GymSessionItemDraft>(() => (item ? itemToDraft(item) : { ...emptyDraft, itemType: rowType }));
  const lastSaved = useRef<GymSessionItemDraft>(draft);

  // Existing row: resync local draft if the item changed underneath us
  // (e.g. an undo restored it, or a sibling action touched it).
  useEffect(() => {
    if (item) {
      const d = itemToDraft(item);
      setDraft(d);
      lastSaved.current = d;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.updatedAt]);

  // New row: switching the type tab clears the draft.
  useEffect(() => {
    if (isNew) {
      const d = { ...emptyDraft, itemType: rowType };
      setDraft(d);
      lastSaved.current = d;
      setQuery('');
      setShowPicker(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowType, isNew]);

  const [query, setQuery] = useState(draft.exerciseName || draft.conditioningExerciseName || draft.runningExerciseName || '');
  const [showPicker, setShowPicker] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const setsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const mine = isNew ? focusRequest.itemId === 'new' : focusRequest.itemId === item?.id;
    if (!mine) return;
    const el = focusRequest.field === 'sets' ? setsInputRef.current : nameInputRef.current;
    if (el) {
      el.focus();
      if ('select' in el) (el as HTMLInputElement).select();
    }
    onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, item?.id, isNew]);

  const patchDraft = (patch: Partial<GymSessionItemDraft>) => setDraft(d => ({ ...d, ...patch }));

  const canSaveDraft = (d: GymSessionItemDraft) => {
    switch (d.itemType) {
      case 'exercise': return !!d.exerciseId;
      case 'conditioning': return !!d.conditioningExerciseId;
      case 'running': return !!d.runningExerciseId;
      case 'note': return !!d.noteText?.trim();
      case 'timer': return !!d.timerLabel?.trim() && d.durationSeconds != null && d.durationSeconds > 0;
      case 'section': return !!d.sectionName?.trim();
      default: return false;
    }
  };

  // Existing row: fire an update for whichever fields actually changed since the last save.
  const commitFieldUpdate = (patch?: Partial<GymSessionItemDraft>) => {
    if (!item || !onUpdateField) return;
    const next = patch ? { ...draft, ...patch } : draft;
    const changed: Partial<GymSessionItemDraft> = {};
    (Object.keys(next) as (keyof GymSessionItemDraft)[]).forEach(k => {
      if (next[k] !== lastSaved.current[k]) (changed as any)[k] = next[k];
    });
    if (Object.keys(changed).length === 0) return;
    lastSaved.current = next;
    if (patch) setDraft(next);
    onUpdateField(item.id, changed);
  };

  // New row: commit-on-pick (or on leaving the row for note/section/timer).
  const commitCreate = (patch?: Partial<GymSessionItemDraft>) => {
    if (!isNew || !onCreate) return;
    const next = patch ? { ...draft, ...patch } : draft;
    if (!canSaveDraft(next)) return;
    onCreate(next);
  };

  const handleRowBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!isNew) return;
    if (rowRef.current && e.relatedTarget && rowRef.current.contains(e.relatedTarget as Node)) return; // focus still inside the row
    if (draft.itemType === 'note' || draft.itemType === 'timer' || draft.itemType === 'section') commitCreate();
  };

  const handleFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (isNew) commitCreate();
    else commitFieldUpdate();
  };

  // ── bank pickers (exercise / conditioning / running) ─────────────────────
  const renderBankPicker = (
    pickedId: string | null,
    pickedLabel: string | undefined,
    matches: { id: string; name: string; label?: string }[],
    noMatchMsg: string,
    onPick: (id: string, name: string, extra?: any) => void,
    matchExtra?: (m: any) => any,
  ) => {
    if (pickedId) {
      return (
        <div className="flex items-center gap-1.5 h-9 px-2.5 border border-emerald-200 rounded-lg bg-emerald-50 min-w-[160px] flex-1">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="text-[13px] font-medium text-emerald-800 truncate flex-1">{pickedLabel}</span>
          <button
            onClick={() => { onPick('', ''); setQuery(''); setShowPicker(true); }}
            className="text-[11px] font-medium text-emerald-700 hover:underline shrink-0"
          >
            Change
          </button>
        </div>
      );
    }
    return (
      <div className="relative flex-1 min-w-[160px]">
        <input
          ref={nameInputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setShowPicker(true); setHighlight(0); }}
          onFocus={() => setShowPicker(true)}
          onKeyDown={e => {
            if (!showPicker || matches.length === 0) { handleFieldKeyDown(e); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              const m = matches[highlight] || matches[0];
              if (m) { onPick(m.id, m.name, matchExtra?.(m)); setQuery(''); setShowPicker(false); }
            } else if (e.key === 'Escape') { setShowPicker(false); }
          }}
          placeholder={isNew ? `Search ${draft.itemType}…` : 'Search…'}
          className={`w-full ${fieldClass}`}
        />
        {showPicker && query.trim() && (
          <div className="absolute z-20 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="px-3 py-2.5 text-[12px] text-slate-400">{noMatchMsg}</p>
            ) : matches.map((m, i) => (
              <button
                key={m.id}
                onMouseDown={e => e.preventDefault()} // keep focus in the input until the click completes
                onClick={() => { onPick(m.id, m.name, matchExtra?.(m)); setQuery(''); setShowPicker(false); }}
                className={`w-full text-left px-3 py-2 text-[13px] flex justify-between ${i === highlight ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span>{m.name}</span>
                {m.label && <span className="text-[11px] text-slate-400">{m.label}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const exerciseMatches = query.trim() ? searchExercises(exercises, query).slice(0, 8).map(e => ({ id: e.id, name: e.name, label: e.exerciseGroupTypeLabel })) : [];
  const conditioningMatches = query.trim() ? searchConditioningExercises(conditioningExercises, query).slice(0, 8).map(e => ({ id: e.id, name: e.name })) : [];
  const runningMatches = query.trim() ? searchRunningExercises(runningExercises, query).slice(0, 8).map(e => ({ id: e.id, name: e.name, label: `${e.distanceMeters}m`, distanceMeters: e.distanceMeters })) : [];

  const num = (v: number | null) => (v ?? '');
  const numOrNull = (s: string) => (s ? Number(s) : null);

  let fields: React.ReactNode = null;

  if (draft.itemType === 'exercise') {
    fields = (
      <div className="flex flex-wrap items-center gap-1.5">
        {renderBankPicker(draft.exerciseId, draft.exerciseName, exerciseMatches, 'No match in the Exercise Bank — ask an Admin to add it there first.', (id, name) => {
          const patch = { exerciseId: id || null, exerciseName: name || undefined };
          if (!id) { patchDraft(patch); return; } // "Change" clicked — just reopen the search box, don't clear the saved item yet
          if (isNew) commitCreate(patch); else { patchDraft(patch); commitFieldUpdate(patch); }
        })}
        <input type="number" min={0} placeholder="Sets" value={num(draft.sets)} onChange={e => patchDraft({ sets: numOrNull(e.target.value) })} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} ref={setsInputRef} className={`w-14 ${fieldClass}`} disabled={isNew && !draft.exerciseId} />
        <input type="number" min={0} placeholder="Reps" value={num(draft.reps)} onChange={e => patchDraft({ reps: numOrNull(e.target.value) })} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} className={`w-14 ${fieldClass}`} disabled={isNew && !draft.exerciseId} />
        <input type="number" min={0} placeholder="kg" value={num(draft.loadKg)} onChange={e => patchDraft({ loadKg: numOrNull(e.target.value) })} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} className={`w-16 ${fieldClass}`} disabled={isNew && !draft.exerciseId} />
      </div>
    );
  } else if (draft.itemType === 'conditioning') {
    fields = (
      <div className="flex flex-wrap items-center gap-1.5">
        {renderBankPicker(draft.conditioningExerciseId, draft.conditioningExerciseName, conditioningMatches, 'No match — ask an Admin to add it to the conditioning list first.', (id, name) => {
          const patch = { conditioningExerciseId: id || null, conditioningExerciseName: name || undefined };
          if (!id) { patchDraft(patch); return; }
          if (isNew) commitCreate(patch); else { patchDraft(patch); commitFieldUpdate(patch); }
        })}
        <input type="number" min={0} placeholder="Sets" value={num(draft.sets)} onChange={e => patchDraft({ sets: numOrNull(e.target.value) })} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} ref={setsInputRef} className={`w-14 ${fieldClass}`} disabled={isNew && !draft.conditioningExerciseId} />
        <input type="number" min={0} placeholder="Reps" value={num(draft.reps)} onChange={e => patchDraft({ reps: numOrNull(e.target.value) })} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} className={`w-14 ${fieldClass}`} disabled={isNew && !draft.conditioningExerciseId} />
      </div>
    );
  } else if (draft.itemType === 'running') {
    fields = (
      <div className="flex flex-wrap items-center gap-1.5">
        {renderBankPicker(
          draft.runningExerciseId,
          draft.runningExerciseName ? `${draft.runningExerciseName}${draft.runningExerciseDistanceMeters != null ? ` · ${draft.runningExerciseDistanceMeters}m` : ''}` : undefined,
          runningMatches,
          'No match — ask an Admin to add it to the running list first.',
          (id, name, extra) => {
            const patch = { runningExerciseId: id || null, runningExerciseName: name || undefined, runningExerciseDistanceMeters: extra?.distanceMeters ?? null };
            if (!id) { patchDraft(patch); return; }
            if (isNew) commitCreate(patch); else { patchDraft(patch); commitFieldUpdate(patch); }
          },
          m => ({ distanceMeters: m.distanceMeters }),
        )}
      </div>
    );
  } else if (draft.itemType === 'timer') {
    const mins = draft.durationSeconds != null ? Math.floor(draft.durationSeconds / 60) : null;
    const secs = draft.durationSeconds != null ? draft.durationSeconds % 60 : null;
    fields = (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={nameInputRef}
          placeholder="Label, e.g. Rest between rounds"
          value={draft.timerLabel ?? ''}
          onChange={e => patchDraft({ timerLabel: e.target.value || null })}
          onBlur={() => commitFieldUpdate()}
          onKeyDown={handleFieldKeyDown}
          className={`flex-1 min-w-[160px] ${fieldClass}`}
        />
        <input type="number" min={0} placeholder="Min" value={mins ?? ''} onChange={e => { const m = e.target.value ? Number(e.target.value) : null; patchDraft({ durationSeconds: (m ?? 0) * 60 + (secs ?? 0) }); }} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} className={`w-14 ${fieldClass}`} />
        <input type="number" min={0} max={59} placeholder="Sec" value={secs ?? ''} onChange={e => { const s = e.target.value ? Number(e.target.value) : null; patchDraft({ durationSeconds: (mins ?? 0) * 60 + (s ?? 0) }); }} onBlur={() => commitFieldUpdate()} onKeyDown={handleFieldKeyDown} className={`w-14 ${fieldClass}`} />
      </div>
    );
  } else if (draft.itemType === 'note') {
    fields = (
      <input
        ref={nameInputRef}
        placeholder="Note text…"
        value={draft.noteText ?? ''}
        onChange={e => patchDraft({ noteText: e.target.value || null })}
        onBlur={() => commitFieldUpdate()}
        onKeyDown={handleFieldKeyDown}
        className={`w-full ${fieldClass}`}
      />
    );
  } else if (draft.itemType === 'section') {
    fields = (
      <div className="flex-1 min-w-[160px]">
        <input
          ref={nameInputRef}
          placeholder="Section name, e.g. Warm-up"
          value={draft.sectionName ?? ''}
          onChange={e => patchDraft({ sectionName: e.target.value || null })}
          onBlur={() => commitFieldUpdate()}
          onKeyDown={handleFieldKeyDown}
          className={`w-full ${fieldClass}`}
        />
        {isNew && frequentSectionNames.length > 0 && !draft.sectionName && (
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            {frequentSectionNames.map(name => (
              <button key={name} onClick={() => commitCreate({ sectionName: name })} className="px-2 py-1 text-[11px] rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">{name}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const TypeIcon = TYPE_ICON[draft.itemType];

  return (
    <div
      ref={rowRef}
      onBlur={handleRowBlur}
      // A left accent border (not a background tint) marks the blank "new" row — a tinted
      // background here would sit flush against the parent card's rounded bottom corners
      // now that the card no longer clips its own contents (see QuickSessionPlanner.tsx),
      // and would poke a square corner out past them.
      className={`flex items-start gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 last:rounded-b-lg ${isNew ? 'border-l-2 border-l-blue-200 bg-blue-50/30' : ''}`}
    >
      <div className="pt-1.5 shrink-0">
        {isNew && onTypeChange ? (
          <TypeMenu current={draft.itemType} onChange={onTypeChange} />
        ) : (
          <TypeIcon className="w-4 h-4 text-slate-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">{fields}</div>
      <div className="flex items-center gap-1 shrink-0 pt-0.5">
        {saving && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
        {!isNew && item && onDelete && (
          <button onClick={() => onDelete(item)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

const TypeMenu = ({ current, onChange }: { current: GymSessionItemType; onChange: (t: GymSessionItemType) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);
  const Icon = TYPE_ICON[current];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-0.5 p-1 rounded hover:bg-slate-100 text-slate-500">
        <Icon className="w-4 h-4" /><ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden w-40">
          {TYPE_TABS.map(({ type, label, Icon: I }) => (
            <button key={type} onClick={() => { onChange(type); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-slate-50 ${type === current ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
              <I className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
