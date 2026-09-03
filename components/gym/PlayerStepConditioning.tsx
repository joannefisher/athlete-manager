// components/gym/PlayerStepConditioning.tsx
// Runner step content for a 'conditioning' item — every prescribed set on
// one page (2026-09-04: previously one set per page). Reps and the Time
// field are editable per set; Intensity(%) stays fixed (confirmed
// explicitly with Joanne — not player-editable), shown via itemMetaText.

import React from 'react';
import type { GymSessionItem } from './types';
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
  item,
  setNumbers,
  getValue,
  onChange,
}: {
  item: GymSessionItem;
  setNumbers: number[];
  getValue: (setNumber: number) => { reps: number | null; durationSeconds: number | null };
  onChange: (setNumber: number, field: 'reps' | 'durationSeconds', value: number | null) => void;
}) {
  return (
    <div>
      <h2 className="text-[19px] font-semibold text-slate-900">{itemDisplayName(item)}</h2>
      <p className="text-[13px] text-slate-400 mt-1">Prescribed: {itemMetaText(item)}</p>

      <div className="mt-5">
        <div className="flex items-center gap-2 px-1 mb-1.5">
          <span className="w-12 shrink-0" />
          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Reps</span>
          <span className="flex-[1.4] text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Time</span>
        </div>
        <div className="space-y-2">
          {setNumbers.map(setNumber => {
            const v = getValue(setNumber);
            const minutes = v.durationSeconds != null ? Math.floor(v.durationSeconds / 60) : null;
            const seconds = v.durationSeconds != null ? v.durationSeconds % 60 : null;
            return (
              <div key={setNumber} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12px] font-semibold text-slate-400">Set {setNumber}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={`Set ${setNumber} reps`}
                  value={v.reps ?? ''}
                  onChange={e => onChange(setNumber, 'reps', e.target.value === '' ? null : Number(e.target.value))}
                  className="flex-1 h-12 px-2 text-[18px] font-semibold text-center border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex-[1.4] flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="mm"
                    aria-label={`Set ${setNumber} minutes`}
                    value={minutes ?? ''}
                    onChange={e => onChange(setNumber, 'durationSeconds', parseMinutesSeconds(e.target.value, seconds != null ? String(seconds) : ''))}
                    className="w-full h-12 px-1 text-[16px] font-semibold text-center border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[14px] font-semibold text-slate-300">:</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="ss"
                    aria-label={`Set ${setNumber} seconds`}
                    value={seconds ?? ''}
                    onChange={e => onChange(setNumber, 'durationSeconds', parseMinutesSeconds(minutes != null ? String(minutes) : '', e.target.value))}
                    className="w-full h-12 px-1 text-[16px] font-semibold text-center border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
