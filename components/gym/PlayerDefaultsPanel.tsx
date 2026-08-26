'use client';

// components/gym/PlayerDefaultsPanel.tsx
// Round 18: shown beside SessionEditor on UI 2's Day tab, in the space to
// the right that SessionEditor's own max-w-2xl cap leaves empty on desktop
// (see GymUI2Root.tsx) — per Joanne: "when a player is selected, on the
// right hand side in the empty space provided, show that player's defaults
// for each exercise combination type that is populated if populated." Reads
// via the existing gym_player_default_primary table/fetchPlayerDefaults —
// same data the player's own "My Defaults" screen (PlayerGymView.tsx) sets —
// so this is a read-only staff-facing view onto it, not a new data source.

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchPlayerDefaults } from './gymApi';
import { groupTypeLabel } from './GroupTypePicker';
import type { GymExerciseGroupType, GymPlayerDefaultPrimary } from './types';

export const PlayerDefaultsPanel = ({
  athleteId,
  athleteName,
  exerciseGroupTypes,
}: {
  athleteId: string;
  athleteName?: string;
  exerciseGroupTypes: GymExerciseGroupType[];
}) => {
  const [defaults, setDefaults] = useState<GymPlayerDefaultPrimary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDefaults(await fetchPlayerDefaults(athleteId));
    } catch (err) {
      console.error('[PlayerDefaultsPanel] failed to load defaults', err);
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useEffect(() => { load(); }, [load]);

  const labelFor = (typeId: string) => {
    const type = exerciseGroupTypes.find(t => t.id === typeId);
    return type ? groupTypeLabel(type) : 'Exercise type';
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3.5">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
        {athleteName ? `${athleteName}'s defaults` : "Player's defaults"}
      </p>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
        </div>
      ) : defaults.length === 0 ? (
        <p className="text-[11.5px] text-slate-400">No default exercises set for this player yet.</p>
      ) : (
        <div className="space-y-2.5">
          {defaults.map(d => (
            <div key={d.id}>
              <p className="text-[10.5px] text-slate-400 leading-tight">{labelFor(d.exerciseGroupTypeId)}</p>
              <p className="text-[12.5px] font-medium text-slate-800 leading-tight">{d.exerciseName || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
