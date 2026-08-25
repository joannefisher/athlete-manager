// components/gym/GymRoot.tsx
// Entry point for the Gym page shown to staff (Admin/S&C/Physio/Coach).
// Owns the shared reference data (exercise bank/groups, gym-only player
// groups) and the selected date/view-mode. Desktop default: a split-screen
// master-detail layout — roster on the left, the selected player's session
// open in a right-hand pane at all times (no click-through needed just to
// see a session). Mobile: tapping a roster row still pushes into a
// full-screen session view, since a two-pane layout doesn't fit a phone.

import React, { useEffect, useState, useCallback } from 'react';
import { Filter, Loader2 } from 'lucide-react';
import type { Role } from '../AthleteManager';
import { WeekStrip, GymViewMode, getWeekDates, todayIso } from './WeekStrip';
import { StaffDailyView } from './StaffDailyView';
import { StaffWeeklyView } from './StaffWeeklyView';
import { SessionEditor } from './SessionEditor';
import { GroupPicker } from './GroupPicker';
import { GroupSessionEditor } from './GroupSessionEditor';
import {
  fetchExerciseGroups,
  fetchExerciseGroupTypes,
  fetchExercises,
  fetchSessionGroups,
  fetchRehabAthleteIds,
} from './gymApi';
import type { GymAthlete as Athlete, GymExerciseGroup, GymExerciseGroupType, GymExercise, GymSessionGroup, GymTeamPosition } from './types';
import { gymCanEdit } from './permissions';

export const GymRoot = ({
  athletes,
  teamStructure,
  role,
  userId,
  clubId,
}: {
  athletes: Athlete[];
  teamStructure: GymTeamPosition[];
  role: Role;
  userId: string;
  clubId: string;
}) => {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  // Default view lands on the current week with today selected, per feedback.
  const [viewMode, setViewMode] = useState<GymViewMode>('week');
  const [loading, setLoading] = useState(true);

  const [exerciseGroups, setExerciseGroups] = useState<GymExerciseGroup[]>([]);
  const [exerciseGroupTypes, setExerciseGroupTypes] = useState<GymExerciseGroupType[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [sessionGroups, setSessionGroups] = useState<GymSessionGroup[]>([]);

  // 'roster' = the default day/week + split session-pane screen,
  // 'groups' = managing gym-only player groups,
  // 'group-editor' = bulk-building/editing a group's session for a date.
  const [screen, setScreen] = useState<'roster' | 'groups' | 'group-editor'>('roster');
  const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // Mobile only: whether the full-screen session view is pushed open over the roster.
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);

  // Player selector — null means "show all" (the default).
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[] | null>(null);
  const [showPlayerFilter, setShowPlayerFilter] = useState(false);
  const [rehabOnly, setRehabOnly] = useState(false);
  const [rehabAthleteIds, setRehabAthleteIds] = useState<Set<string>>(new Set());

  const canEditGym = gymCanEdit(role);
  const weekCommencing = getWeekDates(selectedDate)[0];

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

  // Rehab filter — same definition RehabPlanner.tsx uses for its own weekly
  // roster: an athlete is "on rehab" if they have a row under that week's
  // rehab_plans entry. Re-fetched whenever the visible week changes.
  useEffect(() => {
    let cancelled = false;
    fetchRehabAthleteIds(clubId, weekCommencing)
      .then(ids => { if (!cancelled) setRehabAthleteIds(ids); })
      .catch(err => console.error('[GymRoot] failed to load rehab roster', err));
    return () => { cancelled = true; };
  }, [clubId, weekCommencing]);

  // Default-select the first athlete once the roster loads, so a session is
  // visible in the right-hand pane immediately without clicking anything.
  useEffect(() => {
    if (!editingAthleteId && athletes.length > 0) setEditingAthleteId(athletes[0].id);
  }, [athletes, editingAthleteId]);

  const openSession = (athleteId: string, date: string) => {
    setEditingAthleteId(athleteId);
    setSelectedDate(date);
    setMobileEditorOpen(true);
  };

  const openGroupSession = (groupId: string, date: string) => {
    setEditingGroupId(groupId);
    setSelectedDate(date);
    setScreen('group-editor');
  };

  const togglePlayerFilter = (athleteId: string) => {
    setSelectedAthleteIds(prev => {
      if (prev === null) return [athleteId];
      const next = prev.includes(athleteId) ? prev.filter(id => id !== athleteId) : [...prev, athleteId];
      return next.length === 0 ? null : next;
    });
  };

  const visibleAthletes = athletes
    .filter(a => selectedAthleteIds === null || selectedAthleteIds.includes(a.id))
    .filter(a => !rehabOnly || rehabAthleteIds.has(a.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (screen === 'groups') {
    return (
      <GroupPicker
        clubId={clubId}
        userId={userId}
        athletes={athletes}
        teamStructure={teamStructure}
        sessionGroups={sessionGroups}
        onChanged={loadReferenceData}
        onBack={() => setScreen('roster')}
      />
    );
  }

  if (screen === 'group-editor' && editingGroupId) {
    const group = sessionGroups.find(g => g.id === editingGroupId);
    if (!group) {
      // Group was deleted elsewhere while this screen was open — bounce back.
      setScreen('roster');
      setEditingGroupId(null);
      return null;
    }
    return (
      <GroupSessionEditor
        group={group}
        date={selectedDate}
        clubId={clubId}
        userId={userId}
        athletes={athletes}
        exerciseGroups={exerciseGroups}
        exercises={exercises}
        onExercisesChanged={loadReferenceData}
        onEditIndividual={(athleteId, date) => {
          setScreen('roster');
          setEditingGroupId(null);
          openSession(athleteId, date);
        }}
        onBack={() => { setScreen('roster'); setEditingGroupId(null); }}
      />
    );
  }

  // Player selection is a narrowing tool used occasionally, not the main event —
  // it lives as a compact icon button + popover inside WeekStrip's toolbar rather
  // than a full-width panel above the roster (round 4 feedback).
  const isFiltered = selectedAthleteIds !== null || rehabOnly;
  const playerFilterControl = (
    <div className="relative">
      <button
        onClick={() => setShowPlayerFilter(v => !v)}
        className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[11.5px] font-medium ${
          isFiltered ? 'border-slate-300 text-slate-700 bg-white' : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'
        }`}
      >
        <Filter className="w-3.5 h-3.5" />
        Players
        {isFiltered && (
          <span className="bg-slate-900 text-white text-[9.5px] font-bold rounded-full px-1.5 py-0.5 leading-none">
            {visibleAthletes.length}/{athletes.length}
          </span>
        )}
      </button>
      {showPlayerFilter && (
        <div className="absolute right-0 top-9 z-20 w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Players</span>
            {selectedAthleteIds !== null && (
              <button onClick={() => setSelectedAthleteIds(null)} className="text-[11px] text-blue-600 hover:underline">Show all</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
            {athletes.map(a => {
              const active = selectedAthleteIds === null || selectedAthleteIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => togglePlayerFilter(a.id)}
                  className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-200'}`}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={rehabOnly} onChange={e => setRehabOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
            <span className="text-[11px] font-medium text-slate-500">Rehab only — same players shown in Rehab Planner this week ({rehabAthleteIds.size})</span>
          </label>
        </div>
      )}
    </div>
  );

  const sessionEditor = editingAthleteId ? (
    <SessionEditor
      athlete={athletes.find(a => a.id === editingAthleteId)}
      athleteId={editingAthleteId}
      date={selectedDate}
      clubId={clubId}
      userId={userId}
      canEdit={canEditGym}
      exerciseGroups={exerciseGroups}
      exercises={exercises}
      athletes={athletes}
      sessionGroups={sessionGroups}
      onExercisesChanged={loadReferenceData}
      onBack={() => setMobileEditorOpen(false)}
    />
  ) : (
    <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-[13px] text-slate-400">
      Select a player to see their session.
    </div>
  );

  return (
    <>
      {/* Mobile: full-screen session view pushed over the roster */}
      {mobileEditorOpen && (
        <div className="md:hidden">{sessionEditor}</div>
      )}

      <div className={mobileEditorOpen ? 'hidden md:block' : ''}>
        <div className="max-w-full xl:max-w-7xl mx-auto p-4 md:p-6">
          <WeekStrip
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            extraControls={playerFilterControl}
          />

          <div className="flex flex-col md:flex-row gap-4 items-start">
            <div className="flex-1 min-w-0 w-full">
              {viewMode === 'day' ? (
                <StaffDailyView
                  date={selectedDate}
                  clubId={clubId}
                  athletes={visibleAthletes}
                  sessionGroups={sessionGroups}
                  exerciseGroups={exerciseGroups}
                  exerciseGroupTypes={exerciseGroupTypes}
                  exercises={exercises}
                  canEdit={canEditGym}
                  userId={userId}
                  activeAthleteId={editingAthleteId}
                  rehabAthleteIds={rehabAthleteIds}
                  onOpenSession={openSession}
                  onOpenGroupSession={openGroupSession}
                  onManageGroups={() => setScreen('groups')}
                />
              ) : (
                <StaffWeeklyView
                  selectedDate={selectedDate}
                  clubId={clubId}
                  athletes={visibleAthletes}
                  activeAthleteId={editingAthleteId}
                  rehabAthleteIds={rehabAthleteIds}
                  onSelectDay={date => { setSelectedDate(date); setViewMode('day'); }}
                  onOpenSession={openSession}
                />
              )}
            </div>

            <div className="hidden md:block w-full md:w-[420px] xl:w-[480px] flex-shrink-0 md:sticky md:top-4">
              {sessionEditor}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
