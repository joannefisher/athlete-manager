// components/gym/PlayerStepNote.tsx
// Runner step content for a 'note' item — informational only, Next/Back
// navigation, nothing editable/recorded.

import React from 'react';
import { StickyNote } from 'lucide-react';
import type { RunnerStep } from './types';

export function PlayerStepNote({ step }: { step: RunnerStep }) {
  return (
    <div className="flex flex-col items-center text-center py-6">
      <StickyNote className="w-6 h-6 text-slate-300 mb-3" />
      <p className="text-[16px] text-slate-800 leading-relaxed">{step.item.noteText}</p>
    </div>
  );
}
