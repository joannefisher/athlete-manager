// components/gym/PlayerStepTimer.tsx
// Runner step content for a 'timer' item — a real countdown, nothing
// editable, Skip-only navigation (enforced by the parent runner, which
// hides Next/Back for this step type). Starts counting down as soon as this
// step is shown; the parent remounts this component per step (keyed on
// step.key) so the countdown always starts fresh.

import React, { useEffect, useState } from 'react';
import { TimerIcon } from 'lucide-react';
import type { RunnerStep } from './types';
import { itemDisplayName, formatDuration } from './itemDisplay';

export function PlayerStepTimer({ step }: { step: RunnerStep }) {
  const item = step.item;
  const total = item.durationSeconds ?? 0;
  const [remaining, setRemaining] = useState(total);

  useEffect(() => {
    setRemaining(total);
    if (total <= 0) return;
    const interval = setInterval(() => {
      setRemaining(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [total, step.key]);

  const done = remaining <= 0;

  return (
    <div className="flex flex-col items-center py-4">
      <h2 className="text-[19px] font-semibold text-slate-900 mb-1">{itemDisplayName(item)}</h2>
      <div className={`mt-4 w-40 h-40 rounded-full border-4 flex flex-col items-center justify-center ${done ? 'border-emerald-400 bg-emerald-50' : 'border-blue-400 bg-blue-50'}`}>
        <TimerIcon className={`w-5 h-5 mb-1 ${done ? 'text-emerald-500' : 'text-blue-500'}`} />
        <span className={`text-[32px] font-bold tabular-nums ${done ? 'text-emerald-600' : 'text-blue-600'}`}>{formatDuration(remaining)}</span>
      </div>
      {done && <p className="text-[13px] text-emerald-600 font-medium mt-4">Time's up — tap Skip to continue</p>}
    </div>
  );
}
