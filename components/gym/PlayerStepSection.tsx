// components/gym/PlayerStepSection.tsx
// Runner step content for a 'section' item — a named divider between blocks
// of the session (e.g. "Warm-up" / "Main lifts" / "Cool-down"). 2026-09-04:
// Joanne asked for a section boundary to double as a natural checkpoint —
// the footer PlayerSessionRunner renders for this step swaps the usual
// Next/Back pair for "Continue to next section" / "Exit session" (the
// latter identical to Pause), so a player can stop between blocks without
// it feeling like an abrupt mid-exercise pause. This component itself stays
// display-only; the choice buttons live in the parent, same as the rest of
// the footer.

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { GymSessionItem } from './types';

export function PlayerStepSection({ item }: { item: GymSessionItem }) {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Next up</p>
      <h2 className="text-[24px] font-bold text-slate-900">{item.sectionName}</h2>
      <ArrowRight className="w-5 h-5 text-slate-300 mt-4" />
      <p className="text-[12px] text-slate-400 mt-4 max-w-[240px]">Continue straight into this section, or exit and pick back up here later.</p>
    </div>
  );
}
