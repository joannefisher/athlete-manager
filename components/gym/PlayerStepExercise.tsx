// components/gym/PlayerStepExercise.tsx
// Runner step content for an 'exercise' item — one set at a time. Reps and
// Load(kg) are editable (recorded to gym_session_item_results); Sets/
// Intensity/Tempo stay fixed, shown via itemMetaText as prescribed reference.

import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { RunnerStep } from './types';
import { itemDisplayName, itemMetaText, sideLabel } from './itemDisplay';

export function PlayerStepExercise({
  step,
  reps,
  loadKg,
  onRepsChange,
  onLoadKgChange,
}: {
  step: RunnerStep;
  reps: number | null;
  loadKg: number | null;
  onRepsChange: (v: number | null) => void;
  onLoadKgChange: (v: number | null) => void;
}) {
  const item = step.item;
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
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Load (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            value={loadKg ?? ''}
            onChange={e => onLoadKgChange(e.target.value === '' ? null : Number(e.target.value))}
            className="mt-1 w-full h-14 px-3 text-[22px] font-semibold text-center border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
    </div>
  );
}
