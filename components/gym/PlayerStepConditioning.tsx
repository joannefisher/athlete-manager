// components/gym/PlayerStepConditioning.tsx
// Runner step content for a 'conditioning' item — one set at a time. Reps
// and the new Time field are editable; Intensity(%) stays fixed (confirmed
// explicitly with Joanne — not player-editable), shown via itemMetaText.

import React from 'react';
import type { RunnerStep } from './types';
import { itemDisplayName, itemMetaText, formatDuration } from './itemDisplay';

/** "2:05" -> 125 (seconds). Returns null for empty/unparseable input. */
function parseMinutesSeconds(minutesStr: string, secondsStr: string): number | null {
  const m = minutesStr === '' ? 0 : Number(minutesStr);
  const s = secondsStr === '' ? 0 : Number(secondsStr);
  if (minutesStr === '' && secondsStr === '') return null;
  if (Number.isNaN(m) || Number.isNaN(s)) return null;
  return m * 60 + s;
}

export function PlayerStepConditioning({
  step,
  reps,
  durationSeconds,
  onRepsChange,
  onDurationSecondsChange,
}: {
  step: RunnerStep;
  reps: number | null;
  durationSeconds: number | null;
  onRepsChange: (v: number | null) => void;
  onDurationSecondsChange: (v: number | null) => void;
}) {
  const item = step.item;
  const minutes = durationSeconds != null ? Math.floor(durationSeconds / 60) : null;
  const seconds = durationSeconds != null ? durationSeconds % 60 : null;

  return (
    <div>
      <h2 className="text-[19px] font-semibold text-slate-900">{itemDisplayName(item)}</h2>
      <p className="text-[13px] text-slate-400 mt-1">Prescribed: {itemMetaText(item)}</p>

      <div className="grid grid-cols-2 gap-3 mt-6">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reps</span>
          <input
            type="number"
            inputMode="numeric"
            value={reps ?? ''}
            onChange={e => onRepsChange(e.target.value === '' ? null : Number(e.target.value))}
            className="mt-1 w-full h-14 px-3 text-[22px] font-semibold text-center border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Time</span>
          <div className="mt-1 flex items-center gap-1">
            <input
              type="number"
              inputMode="numeric"
              placeholder="mm"
              value={minutes ?? ''}
              onChange={e => onDurationSecondsChange(parseMinutesSeconds(e.target.value, seconds != null ? String(seconds) : ''))}
              className="w-full h-14 px-2 text-[22px] font-semibold text-center border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[18px] font-semibold text-slate-300">:</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="ss"
              value={seconds ?? ''}
              onChange={e => onDurationSecondsChange(parseMinutesSeconds(minutes != null ? String(minutes) : '', e.target.value))}
              className="w-full h-14 px-2 text-[22px] font-semibold text-center border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
      {durationSeconds != null && <p className="text-[11px] text-slate-400 mt-2 text-center">{formatDuration(durationSeconds)}</p>}
    </div>
  );
}
