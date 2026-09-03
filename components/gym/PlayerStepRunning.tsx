// components/gym/PlayerStepRunning.tsx
// Runner step content for a 'running' item — no per-set breakdown in the
// data model, so this is one editable actual-distance field for the whole
// item (saved with set_number = 1, per migration 0015's comment). The
// prescribed distance (item.runningExerciseDistanceMeters) is shown as
// reference via itemMetaText, same as the staff/read-only views.

import React from 'react';
import type { RunnerStep } from './types';
import { itemDisplayName, itemMetaText } from './itemDisplay';

export function PlayerStepRunning({
  step,
  distanceMeters,
  onDistanceMetersChange,
}: {
  step: RunnerStep;
  distanceMeters: number | null;
  onDistanceMetersChange: (v: number | null) => void;
}) {
  const item = step.item;
  return (
    <div>
      <h2 className="text-[19px] font-semibold text-slate-900">{itemDisplayName(item)}</h2>
      <p className="text-[13px] text-slate-400 mt-1">Prescribed: {itemMetaText(item)}</p>

      <label className="block mt-6">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Actual distance (m)</span>
        <input
          type="number"
          inputMode="decimal"
          value={distanceMeters ?? ''}
          onChange={e => onDistanceMetersChange(e.target.value === '' ? null : Number(e.target.value))}
          className="mt-1 w-full h-14 px-3 text-[22px] font-semibold text-center border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
    </div>
  );
}
