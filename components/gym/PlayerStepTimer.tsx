// components/gym/PlayerStepTimer.tsx
// Runner step content for a 'timer' item — a real countdown, nothing
// editable. 2026-09-04: auto-advances to the next item the moment the
// countdown reaches zero (Joanne's ask — no more waiting for a Skip tap
// once time's up); a manual Skip button is still offered for skipping
// early. `onDone` is the parent's skipTimer — same function used for a
// manual Skip, so "timer finished" and "player tapped Skip" both go through
// one code path. Starts counting down as soon as this step is shown; the
// parent remounts this component per step (keyed on step.key) so the
// countdown always starts fresh.

import React, { useEffect, useState } from 'react';
import { TimerIcon } from 'lucide-react';
import type { GymSessionItem } from './types';
import { itemDisplayName, formatDuration } from './itemDisplay';

export function PlayerStepTimer({ item, stepKey, onDone }: { item: GymSessionItem; stepKey: string; onDone: () => void }) {
  const total = item.durationSeconds ?? 0;
  const [remaining, setRemaining] = useState(total);

  useEffect(() => {
    setRemaining(total);
    if (total <= 0) {
      onDone();
      return;
    }
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onDone();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // Deliberately NOT depending on onDone — it closes over stepIndex/busy
    // and gets a fresh identity every render; re-running this effect on
    // every one of those renders would restart the countdown. total/stepKey
    // changing is the only thing that means "this is genuinely a new timer
    // step," matching the remount-per-step comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, stepKey]);

  const done = remaining <= 0;

  return (
    <div className="flex flex-col items-center py-4">
      <h2 className="text-[19px] font-semibold text-slate-900 mb-1">{itemDisplayName(item)}</h2>
      <div className={`mt-4 w-40 h-40 rounded-full border-4 flex flex-col items-center justify-center ${done ? 'border-emerald-400 bg-emerald-50' : 'border-blue-400 bg-blue-50'}`}>
        <TimerIcon className={`w-5 h-5 mb-1 ${done ? 'text-emerald-500' : 'text-blue-500'}`} />
        <span className={`text-[32px] font-bold tabular-nums ${done ? 'text-emerald-600' : 'text-blue-600'}`}>{formatDuration(remaining)}</span>
      </div>
      {done && <p className="text-[13px] text-emerald-600 font-medium mt-4">Time's up — moving on…</p>}
    </div>
  );
}
