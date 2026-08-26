'use client';

// components/gym/GymSetup.tsx
// Round 18: new Gym sidebar page, Admin/Coach visible (see Gym.tsx). Holds
// exactly two things, per Joanne's answers when this was scoped — Exercise
// Group Type management deliberately stays in the Exercises tab, NOT here:
//
//  1. A spreadsheet-style matrix — every player as a row, every Exercise
//     Group Type as a column, edited inline — for staff to set/override any
//     player's default Primary exercise per type. Same underlying data as
//     each player's own "My Defaults" screen (gym_player_default_primary);
//     this is just the staff-facing, all-players-at-once view onto it.
//  2. An "Add Player" entry point that reuses TrainingPlanner.tsx's own
//     AthleteProfilePage component directly — the exact same
//     create-blank-row-then-open-profile flow Training Planner's own "Add"
//     button uses (see athleteAdmin.ts's file header for the full mirroring
//     notes) — plus CSV bulk-import via the shared CsvAthleteImportModal.
//
// Clicking a player's name in the matrix also opens their profile for
// editing — a small, essentially-free addition once AthleteProfilePage is
// wired in, and a natural fit for a page whose job is "manage players and
// their defaults."

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Role } from '../AthleteManager';
import type { GymExercise, GymExerciseGroupType, GymPlayerDefaultPrimary, GymTeamPosition } from './types';
import { fetchExerciseGroupTypes, fetchExercises, fetchAllPlayerDefaults, setPlayerDefault } from './gymApi';
import {
  fetchFullAthletes,
  fetchSeasonDatesForGym,
  fetchAvailabilityRecordsForGym,
  saveGymAthlete,
  deleteGymAthlete,
  type GymFullAthlete,
  type GymSeasonDate,
  type GymAvailabilityRecord,
} from './athleteAdmin';
import { groupTypeLabel } from './GroupTypePicker';
// Cross-app reuse (round 18) — see athleteAdmin.ts's header comment.
import { AthleteProfilePage } from '../TrainingPlanner';
import { CsvAthleteImportModal, type ParsedAthleteRow } from '../CsvAthleteImportModal';

export const GymSetup = ({
  clubId,
  userId,
  role,
  teamStructure,
}: {
  clubId: string;
  userId: string;
  role: Role;
  teamStructure: GymTeamPosition[];
}) => {
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<GymFullAthlete[]>([]);
  const [groupTypes, setGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [defaults, setDefaults] = useState<GymPlayerDefaultPrimary[]>([]);
  const [seasonDates, setSeasonDates] = useState<GymSeasonDate[]>([]);
  const [availabilityRecords, setAvailabilityRecords] = useState<GymAvailabilityRecord[]>([]);

  const [saving, setSaving] = useState(false);
  const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ath, types, exs, defs, seasons, avail] = await Promise.all([
        fetchFullAthletes(clubId),
        fetchExerciseGroupTypes(clubId),
        fetchExercises(clubId),
        fetchAllPlayerDefaults(clubId),
        fetchSeasonDatesForGym(),
        fetchAvailabilityRecordsForGym(),
      ]);
      setAthletes(ath);
      setGroupTypes(types);
      setExercises(exs);
      setDefaults(defs);
      setSeasonDates(seasons);
      setAvailabilityRecords(avail);
    } catch (err) {
      console.error('[GymSetup] failed to load setup data', err);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // Mirrors TrainingPlanner.tsx's own "Add" button exactly — a blank insert,
  // then straight into the full profile editor.
  const handleAddPlayer = async () => {
    const { data, error } = await supabase
      .from('athletes')
      .insert({ name: 'New Athlete', status: 'Available', notes: '', is_public: false, avatar: 'NA', photo_url: '' })
      .select()
      .single();
    if (!error && data) {
      await load();
      setEditingAthleteId(data.id);
    }
  };

  const handleCsvImport = async (rows: ParsedAthleteRow[]) => {
    for (const row of rows) {
      const { data, error } = await supabase
        .from('athletes')
        .insert({ name: row.name, status: row.status, notes: row.notes, is_public: row.isPublic, avatar: row.avatar, photo_url: '' })
        .select()
        .single();
      if (!error && data && row.positionNumbers.length > 0) {
        await supabase
          .from('athlete_positions')
          .insert(row.positionNumbers.map(pn => ({ athlete_id: data.id, position_number: pn })));
      }
    }
    await load();
  };

  const handleSetCell = async (athleteId: string, typeId: string, exerciseId: string) => {
    const cellKey = `${athleteId}:${typeId}`;
    setSavingCell(cellKey);
    try {
      await setPlayerDefault(clubId, athleteId, typeId, exerciseId, userId);
      const exerciseName = exercises.find(e => e.id === exerciseId)?.name;
      setDefaults(prev => {
        const next = prev.filter(d => !(d.athleteId === athleteId && d.exerciseGroupTypeId === typeId));
        next.push({
          id: `${athleteId}-${typeId}`,
          clubId,
          athleteId,
          exerciseGroupTypeId: typeId,
          exerciseId,
          exerciseName,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        });
        return next;
      });
    } catch (err) {
      console.error('[GymSetup] failed to set default', err);
    } finally {
      setSavingCell(null);
    }
  };

  if (editingAthleteId) {
    return (
      <AthleteProfilePage
        athletes={athletes}
        athleteId={editingAthleteId}
        navigateTo={() => setEditingAthleteId(null)}
        availabilityRecords={availabilityRecords}
        seasonDates={seasonDates}
        teamStructure={teamStructure}
        onSave={async (athlete: GymFullAthlete) => {
          setSaving(true);
          try {
            await saveGymAthlete(athlete);
            await load();
          } finally {
            setSaving(false);
          }
        }}
        onDelete={async (athleteId: string) => {
          await deleteGymAthlete(athleteId);
          await load();
        }}
        saving={saving}
        role={role}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4 w-full">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-800">Player default exercises</h3>
          <p className="text-[12px] text-slate-400 mt-0.5">
            Set or override any player's default Primary exercise for each exercise type. Click a player's name to edit their profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCsvImport(true)}
            className="h-8 px-3 flex items-center gap-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
          <button
            onClick={handleAddPlayer}
            className="h-8 px-3 flex items-center gap-1.5 text-[12px] font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-700 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" /> Add Player
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
        </div>
      ) : groupTypes.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-[13px] text-slate-400">
          No exercise group types set up yet — add one from the Exercises tab first.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-auto">
          <table className="min-w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Player</th>
                {groupTypes.map(t => (
                  <th key={t.id} className="px-2 py-2 font-semibold text-slate-600 text-left whitespace-nowrap min-w-[170px]">
                    {groupTypeLabel(t)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {athletes.map(a => (
                <tr key={a.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                    <button onClick={() => setEditingAthleteId(a.id)} className="hover:underline hover:text-blue-600 text-left">
                      {a.name}
                    </button>
                  </td>
                  {groupTypes.map(t => {
                    const options = exercises.filter(e => e.exerciseGroupTypeId === t.id);
                    const current = defaults.find(d => d.athleteId === a.id && d.exerciseGroupTypeId === t.id);
                    const cellKey = `${a.id}:${t.id}`;
                    return (
                      <td key={t.id} className="px-2 py-1.5">
                        <select
                          value={current?.exerciseId || ''}
                          disabled={savingCell === cellKey || options.length === 0}
                          onChange={e => { if (e.target.value) handleSetCell(a.id, t.id, e.target.value); }}
                          className="w-full h-8 px-1.5 text-[11.5px] border border-slate-200 rounded bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">{options.length === 0 ? '—' : 'Not set'}</option>
                          {options.map(ex => (
                            <option key={ex.id} value={ex.id}>{ex.name}</option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {athletes.length === 0 && (
                <tr>
                  <td colSpan={groupTypes.length + 1} className="px-3 py-8 text-center text-slate-400">
                    No players yet — use Add Player or Import CSV above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCsvImport && (
        <CsvAthleteImportModal
          teamStructure={teamStructure}
          onClose={() => setShowCsvImport(false)}
          onImport={handleCsvImport}
        />
      )}
    </div>
  );
};
