'use client';

// components/gym/PlayerDefaultExercisesPicker.tsx
// New (2026-09-03), per Joanne's request: "add the default exercises as
// options when adding a new player so [they] can be set in a single setup
// ... do this across the app where you add players - this is optional."
//
// Reused by AthleteProfilePage (../TrainingPlanner.tsx) — the single
// component both Training Planner's "Add" button and Gym Setup's "Add
// Player" button open right after creating a new athlete row (see
// GymSetup.tsx's file header for that cross-app reuse). Dropping this in
// there means both entry points get it for free from one change.
//
// Deliberately NOT wired into the CSV bulk-import flows (both apps) — per
// Joanne's answer when this was scoped, bulk import stays as-is; defaults
// for imported players can still be set individually afterwards from here
// or from Gym Setup's existing all-players matrix.
//
// Entirely optional and self-contained: fetches its own exercise-group-type
// list, exercise list, and any defaults this athlete already has, and saves
// each pick immediately via setPlayerDefault() (same call GymSetup.tsx's
// matrix cells use) — no parent wiring beyond clubId/athleteId/updatedBy.
// Renders nothing if this club has no exercise group types set up yet
// (mirrors GymSetup.tsx's own guard for the same case).

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { GymExercise, GymExerciseGroupType, GymPlayerDefaultPrimary } from './types';
import { fetchExerciseGroupTypes, fetchExercises, fetchPlayerDefaults, setPlayerDefault } from './gymApi';
import { groupTypeLabel } from './GroupTypePicker';

export const PlayerDefaultExercisesPicker = ({
  clubId,
  athleteId,
  updatedBy,
}: {
  clubId: string;
  athleteId: string;
  updatedBy: string;
}) => {
  const [loading, setLoading] = useState(true);
  const [groupTypes, setGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [defaults, setDefaults] = useState<GymPlayerDefaultPrimary[]>([]);
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [types, exs, defs] = await Promise.all([
          fetchExerciseGroupTypes(clubId),
          fetchExercises(clubId),
          fetchPlayerDefaults(athleteId),
        ]);
        if (!cancelled) {
          setGroupTypes(types);
          setExercises(exs);
          setDefaults(defs);
        }
      } catch (err) {
        console.error('[PlayerDefaultExercisesPicker] failed to load exercise data', err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, athleteId]);

  const handleSet = async (typeId: string, exerciseId: string) => {
    setSavingTypeId(typeId);
    try {
      await setPlayerDefault(clubId, athleteId, typeId, exerciseId, updatedBy);
      const exerciseName = exercises.find(e => e.id === exerciseId)?.name;
      setDefaults(prev => {
        const next = prev.filter(d => d.exerciseGroupTypeId !== typeId);
        next.push({
          id: `${athleteId}-${typeId}`,
          clubId,
          athleteId,
          exerciseGroupTypeId: typeId,
          exerciseId,
          exerciseName,
          updatedBy,
          updatedAt: new Date().toISOString(),
        });
        return next;
      });
    } catch (err) {
      console.error('[PlayerDefaultExercisesPicker] failed to set default', err);
    } finally {
      setSavingTypeId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
      </div>
    );
  }

  // Silent no-render on load failure or an empty list — this section is
  // entirely optional, so a problem here shouldn't block adding the player.
  if (loadError || groupTypes.length === 0) return null;

  return (
    <div>
      <label className="block text-[12px] font-medium mb-1">
        Default exercises <span className="text-slate-400 font-normal">(optional)</span>
      </label>
      <p className="text-[11px] text-slate-400 mb-2">
        Set this player's default Primary exercise for any exercise type now, or leave blank and set it later from Gym Setup.
      </p>
      <div className="space-y-1.5">
        {groupTypes.map(t => {
          const options = exercises.filter(e => e.exerciseGroupTypeId === t.id);
          const current = defaults.find(d => d.exerciseGroupTypeId === t.id);
          return (
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-32 md:w-36 shrink-0 text-[11.5px] text-slate-500 truncate" title={groupTypeLabel(t)}>
                {groupTypeLabel(t)}
              </span>
              <select
                value={current?.exerciseId || ''}
                disabled={savingTypeId === t.id || options.length === 0}
                onChange={e => { if (e.target.value) handleSet(t.id, e.target.value); }}
                className="flex-1 h-8 px-1.5 text-[11.5px] border border-slate-200 rounded bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">{options.length === 0 ? '—' : 'Not set'}</option>
                {options.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
};
