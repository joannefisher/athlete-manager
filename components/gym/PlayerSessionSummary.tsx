// components/gym/PlayerSessionSummary.tsx
// Shown after the player finishes the last step of a session (see
// PlayerSessionRunner's goNext/skipTimer) — a read-only recap of prescribed
// vs. actual, per item and per set, grouped/labelled by superset using the
// exact same supersetDnd.ts helpers (groupBySuperset/labelSupersetGroups) as
// the runner itself and the staff editors, so "Superset A" means the same
// thing everywhere. The session is already marked completed server-side by
// the time this renders (PlayerSessionRunner calls completeSession before
// showing this screen) — the Done button here is purely navigational (back
// to Today), not a save action.

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { groupBySuperset, labelSupersetGroups } from './supersetDnd';
import { formatDuration, formatIntensityPct, itemDisplayName } from './itemDisplay';
import type { GymSession, GymSessionItem, GymSessionItemResult } from './types';

function resultsForItem(results: GymSessionItemResult[], itemId: string): GymSessionItemResult[] {
  return results.filter(r => r.sessionItemId === itemId).sort((a, b) => a.setNumber - b.setNumber);
}

/** "1h 04m" / "42m 10s" — startedAt/completedAt come from the player_start_session/player_complete_session RPCs, so both are only ever missing if the player somehow reached this screen without going through the normal flow (defensive null-safe, not expected in practice). */
function elapsedLabel(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

function ItemRow({ item, results }: { item: GymSessionItem; results: GymSessionItemResult[] }) {
  const name = itemDisplayName(item);

  if (item.itemType === 'note' || item.itemType === 'section') {
    return (
      <div className="py-2">
        <p className="text-[13px] font-medium text-slate-500">{name}</p>
      </div>
    );
  }

  if (item.itemType === 'timer') {
    return (
      <div className="py-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-slate-700">{name}</p>
        <p className="text-[12px] text-slate-400 shrink-0">{item.durationSeconds != null ? formatDuration(item.durationSeconds) : '—'}</p>
      </div>
    );
  }

  if (item.itemType === 'running') {
    const actual = results.find(r => r.setNumber === 1)?.actualDistanceMeters ?? null;
    const prescribed = item.runningExerciseDistanceMeters ?? null;
    return (
      <div className="py-2">
        <p className="text-[13px] font-medium text-slate-700 mb-1">{name}</p>
        <div className="flex items-center gap-4 text-[12px]">
          <span className="text-slate-400">Prescribed: {prescribed != null ? `${prescribed}m` : '—'}</span>
          <span className="text-slate-900 font-semibold">Actual: {actual != null ? `${actual}m` : '—'}</span>
        </div>
      </div>
    );
  }

  // exercise / conditioning — per-set breakdown. Rows are driven by whichever
  // is longer, prescribed sets or recorded results, so a player who somehow
  // recorded more/fewer sets than prescribed still sees everything they did.
  const totalSets = Math.max(item.sets ?? 0, results.length, 1);

  return (
    <div className="py-2">
      <p className="text-[13px] font-medium text-slate-700 mb-1">{name}</p>
      <div className="space-y-1">
        {Array.from({ length: totalSets }, (_, i) => i + 1).map(setNumber => {
          const r = results.find(res => res.setNumber === setNumber);
          const prescribed =
            item.itemType === 'exercise'
              ? [item.reps ? `${item.reps} reps` : null, item.loadKg != null ? `${item.loadKg}kg` : null].filter(Boolean).join(' × ') || '—'
              : [item.reps ? `${item.reps} reps` : null, item.load ? `@ ${formatIntensityPct(item.load)}` : null].filter(Boolean).join(' × ') || '—';
          const actual = r
            ? item.itemType === 'exercise'
              ? [r.actualReps != null ? `${r.actualReps} reps` : null, r.actualLoadKg != null ? `${r.actualLoadKg}kg` : null].filter(Boolean).join(' × ') || '—'
              : [r.actualReps != null ? `${r.actualReps} reps` : null, r.actualDurationSeconds != null ? formatDuration(r.actualDurationSeconds) : null].filter(Boolean).join(' × ') || '—'
            : '—';
          return (
            <div key={setNumber} className="flex items-center justify-between text-[12px] gap-2">
              <span className="text-slate-400 w-10 shrink-0">Set {setNumber}</span>
              <span className="text-slate-400 flex-1">{prescribed}</span>
              <span className="text-slate-900 font-semibold flex-1 text-right">{actual}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlayerSessionSummary({ session, onDone }: { session: GymSession; onDone: () => void }) {
  const items = session.items || [];
  const results = session.results || [];
  const groups = groupBySuperset(items);
  const labels = labelSupersetGroups(items);
  const elapsed = elapsedLabel(session.startedAt, session.completedAt);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50">
      <div className="px-4 py-8 max-w-md mx-auto w-full flex-1">
        <div className="flex flex-col items-center text-center mb-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
          <h1 className="text-[17px] font-semibold text-slate-900">Session complete</h1>
          <p className="text-[12px] text-slate-400 mt-1">
            {new Date(session.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            {elapsed ? ` · Took ${elapsed}` : ''}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 px-4">
          {groups.length === 0 && (
            <p className="text-[13px] text-slate-400 py-4 text-center">No exercises in this session.</p>
          )}
          {groups.map(group => {
            if (!group.supersetId || group.members.length < 2) {
              return group.members.map(item => (
                <ItemRow key={item.id} item={item} results={resultsForItem(results, item.id)} />
              ));
            }
            return (
              <div key={group.supersetId} className="py-2">
                <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide mb-1">Superset {labels.get(group.supersetId)}</p>
                <div className="divide-y divide-slate-50">
                  {group.members.map(item => (
                    <ItemRow key={item.id} item={item} results={resultsForItem(results, item.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
        <button
          onClick={onDone}
          className="w-full h-12 flex items-center justify-center rounded-xl bg-slate-900 text-white text-[14px] font-semibold max-w-md mx-auto"
        >
          Done
        </button>
      </div>
    </div>
  );
}
