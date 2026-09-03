// components/gym/PlayerStepExercise.tsx
// Runner step content for an 'exercise' item — every prescribed set on one
// page (2026-09-04: previously one set per page). Reps and Load(kg) are
// editable per set (recorded to gym_session_item_results); Sets/Intensity/
// Tempo stay fixed, shown via itemMetaText as prescribed reference.

import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { GymSessionItem } from './types';
import { itemDisplayName, itemMetaText, sideLabel } from './itemDisplay';

export function PlayerStepExercise({
  item,
  setNumbers,
  getValue,
  onChange,
}: {
  item: GymSessionItem;
  setNumbers: number[];
  getValue: (setNumber: number) => { reps: number | null; loadKg: number | null };
  onChange: (setNumber: number, field: 'reps' | 'loadKg', value: number | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <h2 className="text-[19px] font-semibold text-slate-900">{itemDisplayName(item)}</h2>
        {item.side !== 'both' && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{sideLabel(item.side)}</span>
        )}
        {item.isPrimary && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">Primary</span>
        )}
        {item.wasSwapped && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
            <RefreshCw className="w-2.5 h-2.5" /> swapped
          </span>
        )}
      </div>
      <p className="text-[13px] text-slate-400 mt-1">Prescribed: {itemMetaText(item)}</p>

      <div className="mt-5">
        <div className="flex items-center gap-2 px-1 mb-1.5">
          <span className="w-12 shrink-0" />
          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Reps</span>
          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Load (kg)</span>
        </div>
        <div className="space-y-2">
          {setNumbers.map(setNumber => {
            const v = getValue(setNumber);
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
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  aria-label={`Set ${setNumber} load in kilograms`}
                  value={v.loadKg ?? ''}
                  onChange={e => onChange(setNumber, 'loadKg', e.target.value === '' ? null : Number(e.target.value))}
                  className="flex-1 h-12 px-2 text-[18px] font-semibold text-center border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
