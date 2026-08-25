// components/gym/GymRoot.tsx
// Entry point for the Gym page shown to staff (Admin/S&C/Physio/Coach).
// Owns the shared reference data (exercise bank/groups, gym-only player
// groups) and the selected date/view-mode, and switches between the daily
// roster, the weekly grid, and the session editor.

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { Role } from '../AthleteManager';
import { WeekStrip, GymViewMode, todayIso } from './WeekStrip';
import { StaffDailyView } from './StaffDailyView';
import { StaffWeeklyView } from './StaffWeeklyView';
import { SessionEditor } from './SessionEditor';
import { GroupPicker } from './GroupPicker';
import {
  fetchExerciseGroups,
  fetchExerciseGroupTypes,
  fetchExercises,
  fetchSessionGroups,
} from './gymApi';
import type { GymAthlete as Athlete, GymExerciseGroup, GymExerciseGroupType, GymExercise, GymSessionGroup } from './types';
import { gymCanEdit } from './permissions';

export const GymRoot = ({ athletes, role, userId, clubId }: { athletes: Athlete[]; role: Role; userId: string; clubId: string }) => {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [viewMode, setViewMode] = useState<GymViewMode>('day');
  const [loading, setLoading] = useState(true);

  const [exerciseGroups, setExerciseGroups] = useState<GymExerciseGroup[]>([]);
  const [exerciseGroupTypes, setExerciseGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [sessionGroups, setSessionGroups] = useState<GymSessionGroup[]>([]);

  // 'roster' = daily/weekly views, 'editor' = editing one athlete's session,
  // 'groups' = managing gym-only player groups
  const [screen, setScreen] = useState<'roster' | 'editor' | 'groups'>('roster');
  const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);

  const canEditGym = gymCanEdit(role);

  const loadReferenceData = useCallback(async () => {
    setLoading(true);
    try {
      const [groups, types, exs, sGroups] = await Promise.all([
        fetchExerciseGroups(clubId),
        fetchExerciseGroupTypes(clubId),
        fetchExercises(clubId),
        fetchSessionGroups(clubId),
      ]);
      setExerciseGroups(groups);
      setExerciseGroupTypes(types);
      setExercises(exs);
      setSessionGroups(sGroups);
    } catch (err) {
      console.error('[GymRoot] failed to load reference data', err);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  const openSession = (athleteId: string, date: string) => {
    setEditingAthleteId(athleteId);
    setSelectedDate(date);
    setScreen('editor');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (screen === 'editor' && editingAthleteId) {
    const athlete = athletes.find(a => a.id === editingAthleteId);
    return (
      <SessionEditor
        athlete={athlete}
        athleteId={editingAthleteId}
        date={selectedDate}
        clubId={clubId}
        userId={userId}
        canEdit={canEditGym}
        exerciseGroups={exerciseGroups}
        exercises={exercises}
        onExercisesChanged={loadReferenceData}
        onBack={() => { setScreen('roster'); setEditingAthleteId(null); }}
      />
    );
  }

  if (screen === 'groups') {
    return (
      <GroupPicker
        clubId={clubId}
        userId={userId}
        athletes={athletes}
        sessionGroups={sessionGroups}
        onChanged={loadReferenceData}
        onBack={() => setScreen('roster')}
      />
    );
  }

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      <WeekStrip selectedDate={selectedDate} onDateChange={setSelectedDate} viewMode={viewMode} onViewModeChange={setViewMode} />

      {viewMode === 'day' ? (
        <StaffDailyView
          date={selectedDate}
          clubId={clubId}
          athletes={athletes}
          sessionGroups={sessionGroups}
          exerciseGroups={exerciseGroups}
          exerciseGroupTypes={exerciseGroupTypes}
          canEdit={canEditGym}
          userId={userId}
          onOpenSession={openSession}
          onManageGroups={() => setScreen('groups')}
        />
      ) : (
        <StaffWeeklyView
          selectedDate={selectedDate}
          clubId={clubId}
          athletes={athletes}
          onSelectDay={date => { setSelectedDate(date); setViewMode('day'); }}
          onOpenSession={openSession}
        />
      )}
    </div>
  );
};
