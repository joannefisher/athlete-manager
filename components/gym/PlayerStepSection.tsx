// components/gym/PlayerStepSection.tsx
// Runner step content for a 'section' item — a simple named divider between
// blocks of the session, informational only, Next/Back navigation, nothing
// editable/recorded (same as PlayerStepNote's role, distinct wording).

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { RunnerStep } from './types';

export function PlayerStepSection({ step }: { step: RunnerStep }) {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Next up</p>
      <h2 className="text-[24px] font-bold text-slate-900">{step.item.sectionName}</h2>
      <ArrowRight className="w-5 h-5 text-slate-300 mt-4" />
    </div>
  );
}
