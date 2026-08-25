// components/gym/SessionItemChip.tsx
// Compact "what's actually planned" chip for one session item — exercise
// name + sets/reps/load (with split-side/Primary/swapped tags), or a note
// preview. Used by StaffDailyView's roster rows so the day view leads with
// real session detail instead of an item count (round 4 feedback).

import React from 'react';
import { RefreshCw, StickyNote } from 'lucide-react';
import type { GymSessionItem } from './types';
import { itemDisplayName, itemMetaText, sideLabel } from './itemDisplay';

export const SessionItemChip = ({ item }: { item: GymSessionItem }) => {
  if (item.itemType !== 'exercise') {
    return (
      <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 max-w-full">
        <StickyNote className="w-3 h-3 text-slate-300 flex-shrink-0" />
        <span className="text-[11px] text-slate-600 italic truncate">{item.noteText}</span>
      </div>
    );
  }
  return (
    <div className="inline-flex flex-col gap-0.5 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 max-w-full">
      <span className="text-[11.5px] font-semibold text-slate-700 flex items-center gap-1 flex-wrap">
        <span className="truncate">{itemDisplayName(item)}</span>
        {item.side !== 'both' && (
          <span className="text-[8.5px] font-bold px-1.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 leading-[14px] flex-shrink-0">
            {sideLabel(item.side)}
          </span>
        )}
        {item.isPrimary && (
          <span className="text-[8.5px] font-bold px-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 leading-[14px] flex-shrink-0">
            Primary
          </span>
        )}
        {item.wasSwapped && (
          <span title="Swapped to this player's default" className="flex-shrink-0">
            <RefreshCw className="w-2.5 h-2.5 text-amber-500" />
          </span>
        )}
      </span>
      <span className="text-[10.5px] text-slate-400">{itemMetaText(item)}</span>
    </div>
  );
};
