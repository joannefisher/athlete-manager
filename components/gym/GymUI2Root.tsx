// components/gym/GymUI2Root.tsx
// UI 2 — Concept C ("Tabbed Scope-First"), built for real per the approved
// mockup direction: a scope switcher (Player / Group, a group always
// resolving to exactly one selected member at a time), a date stepper whose
// arrows step by day (Day/Compare tabs) or by month (Calendar tab), a
// click-to-open date-picker popover (Concept B's mini-calendar) instead of
// arrows-only navigation, a mode-dependent action button ("Today" in Day
// mode, "This Week" in Calendar mode), and three tabs: Day (the existing
// SessionEditor, full width, no split-pane), Calendar (month grid with full
// session detail inline, plus add-without-leaving-Calendar), and Compare
// (same-weekday-past-weeks, or players-on-a-date). UI 1 (GymRoot) is
// untouched — this is a sibling, switched to from Gym.tsx's UI 1/UI 2 toggle.

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { Role } from '../AthleteManager';
import type { GymAthlete as Athlete, GymExerciseGroup, GymExercise, GymSessionGroup, GymTeamPosition } from './types';
import { fetchExerciseGroups, fetchExercises, fetchSessionGroups } from './gymApi';
import { todayIso } from './WeekStrip';
import { gymCanEdit } from './permissions';
import { SessionEditor } from './SessionEditor';
import { GymUI2Calendar } from './GymUI2Calendar';
import { GymUI2Compare } from './GymUI2Compare';
import { GymUI2GroupCalendar } from './GymUI2GroupCalendar';
import { GymUI2GroupCompare } from './GymUI2GroupCompare';
import { GroupPlanEditor } from './GroupPlanEditor';
import { MoveSessionButton } from './MoveSessionButton';
import { DatePickerPopover } from './DatePickerPopover';

type ScopeMode = 'player' | 'group';
type UI2Tab = 'day' | 'calendar' | 'compare';
const ALL_MEMBERS = '__all__';

export const GymUI2Root = ({
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
  const canEditGym = gymCanEdit(role);

  const [loading, setLoading] = useState(true);
  const [exerciseGroups, setExerciseGroups] = useState<GymExerciseGroup[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [sessionGroups, setSessionGroups] = useState<GymSessionGroup[]>([]);

  const [scopeMode, setScopeMode] = useState<ScopeMode>('player');
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  const [tab, setTab] = useState<UI2Tab>('day');
  const [date, setDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadReferenceData = useCallback(async () => {
    setLoading(true);
    try {
      const [groups, exs, sGroups] = await Promise.all([
        fetchExerciseGroups(clubId),
        fetchExercises(clubId),
        fetchSessionGroups(clubId),
      ]);
      setExerciseGroups(groups);
      setExercises(exs);
      setSessionGroups(sGroups);
    } catch (err) {
      console.error('[GymUI2Root] failed to load reference data', err);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

  // Default-select the first athlete once the roster loads.
  useEffect(() => {
    if (!selectedAthleteId && athletes.length > 0) setSelectedAthleteId(athletes[0].id);
  }, [athletes, selectedAthleteId]);

  // Default-select the first group, and its first member, once groups load.
  useEffect(() => {
    if (scopeMode === 'group' && !selectedGroupId && sessionGroups.length > 0) {
      setSelectedGroupId(sessionGroups[0].id);
    }
  }, [scopeMode, selectedGroupId, sessionGroups]);

  const currentGroup = sessionGroups.find(g => g.id === selectedGroupId);
  const groupMembers = currentGroup ? athletes.filter(a => currentGroup.memberAthleteIds.includes(a.id)) : [];

  useEffect(() => {
    if (
      scopeMode === 'group' &&
      currentGroup &&
      (!selectedMemberId || (selectedMemberId !== ALL_MEMBERS && !currentGroup.memberAthleteIds.includes(selectedMemberId)))
    ) {
      setSelectedMemberId(ALL_MEMBERS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeMode, currentGroup?.id]);

  const isAllMode = scopeMode === 'group' && selectedMemberId === ALL_MEMBERS;
  const currentAthleteId = scopeMode === 'player' ? selectedAthleteId : isAllMode ? '' : selectedMemberId;
  const currentAthlete = athletes.find(a => a.id === currentAthleteId);

  const stepDate = (dir: 1 | -1) => {
    const d = new Date(date + 'T00:00:00');
    if (tab === 'calendar') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir);
    setDate(d.toISOString().split('T')[0]);
  };

  const jumpToToday = () => setDate(todayIso());

  const dateLabel =
    tab === 'calendar'
      ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full p-4 md:p-6 space-y-3">
      {/* Scope switcher */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium">
          <button
            onClick={() => setScopeMode('player')}
            className={`px-3 py-1.5 rounded ${scopeMode === 'player' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            Player
          </button>
          <button
            onClick={() => setScopeMode('group')}
            className={`px-3 py-1.5 rounded ${scopeMode === 'group' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            Group
          </button>
        </div>

        {scopeMode === 'player' ? (
          <div className="relative">
            <select
              value={selectedAthleteId}
              onChange={e => setSelectedAthleteId(e.target.value)}
              className="h-8 pl-2.5 pr-7 rounded-md border border-slate-200 bg-white text-[12.5px] font-medium text-slate-700 appearance-none"
            >
              {athletes.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        ) : (
          <>
            <div className="relative">
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                className="h-8 pl-2.5 pr-7 rounded-md border border-slate-200 bg-white text-[12.5px] font-medium text-slate-700 appearance-none"
              >
                {sessionGroups.length === 0 && <option value="">No groups yet</option>}
                {sessionGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.memberAthleteIds.length})</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {currentGroup && (
              <div className="relative">
                <select
                  value={selectedMemberId}
                  onChange={e => setSelectedMemberId(e.target.value)}
                  className={`h-8 pl-2.5 pr-7 rounded-md border text-[12.5px] font-medium appearance-none ${
                    isAllMode ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {groupMembers.length === 0 ? (
                    <option value="">No members</option>
                  ) : (
                    <option value={ALL_MEMBERS}>All players ({groupMembers.length})</option>
                  )}
                  {groupMembers.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className={`w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${isAllMode ? 'text-white/70' : 'text-slate-400'}`} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Date stepper + tabs */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-2 flex-wrap">
        <button onClick={() => stepDate(-1)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowDatePicker(v => !v)}
            className="h-8 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[13px] font-semibold text-slate-800"
          >
            {dateLabel}
          </button>
          {showDatePicker && (
            <DatePickerPopover
              value={date}
              onChange={d => setDate(d)}
              onClose={() => setShowDatePicker(false)}
            />
          )}
        </div>
        <button onClick={() => stepDate(1)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={jumpToToday}
          className="h-8 px-2.5 text-[12px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
        >
          {tab === 'calendar' ? 'This Week' : 'Today'}
        </button>

        {tab === 'day' && canEditGym && (isAllMode ? !!currentGroup : !!currentAthleteId) && (
          <MoveSessionButton
            clubId={clubId}
            userId={userId}
            date={date}
            isAllMode={isAllMode}
            currentAthleteId={currentAthleteId}
            groupMemberAthleteIds={currentGroup?.memberAthleteIds || []}
            athletes={athletes}
            exercises={exercises}
            onMoved={() => setRefreshNonce(n => n + 1)}
          />
        )}

        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium ml-auto">
          {(['day', 'calendar', 'compare'] as UI2Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded capitalize ${tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {isAllMode && currentGroup ? (
        tab === 'day' ? (
          <GroupPlanEditor
            key={`${currentGroup.id}-${date}-${refreshNonce}`}
            group={currentGroup}
            date={date}
            clubId={clubId}
            userId={userId}
            canEdit={canEditGym}
            athletes={athletes}
            exerciseGroups={exerciseGroups}
            exercises={exercises}
            onExercisesChanged={loadReferenceData}
          />
        ) : tab === 'calendar' ? (
          <GymUI2GroupCalendar
            key={`group-${currentGroup.id}`}
            group={currentGroup}
            monthAnchor={date}
            clubId={clubId}
            userId={userId}
            canEdit={canEditGym}
            athletes={athletes}
            exerciseGroups={exerciseGroups}
            exercises={exercises}
            onExercisesChanged={loadReferenceData}
            selectedDate={date}
            onSelectDate={setDate}
          />
        ) : (
          <GymUI2GroupCompare
            key={`group-${currentGroup.id}`}
            group={currentGroup}
            clubId={clubId}
            userId={userId}
            canEdit={canEditGym}
            exercises={exercises}
            anchorDate={date}
          />
        )
      ) : !currentAthleteId ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-[13px] text-slate-400">
          {scopeMode === 'group' ? 'Choose a group with at least one member to see sessions.' : 'Select a player to see their session.'}
        </div>
      ) : tab === 'day' ? (
        <SessionEditor
          key={`${currentAthleteId}-${date}-${refreshNonce}`}
          athlete={currentAthlete}
          athleteId={currentAthleteId}
          date={date}
          clubId={clubId}
          userId={userId}
          canEdit={canEditGym}
          exerciseGroups={exerciseGroups}
          exercises={exercises}
          athletes={athletes}
          sessionGroups={sessionGroups}
          onExercisesChanged={loadReferenceData}
        />
      ) : tab === 'calendar' ? (
        <GymUI2Calendar
          key={currentAthleteId}
          athlete={currentAthlete}
          athleteId={currentAthleteId}
          monthAnchor={date}
          clubId={clubId}
          userId={userId}
          canEdit={canEditGym}
          exerciseGroups={exerciseGroups}
          exercises={exercises}
          athletes={athletes}
          sessionGroups={sessionGroups}
          onExercisesChanged={loadReferenceData}
          selectedDate={date}
          onSelectDate={setDate}
        />
      ) : (
        <GymUI2Compare
          key={currentAthleteId}
          clubId={clubId}
          userId={userId}
          canEdit={canEditGym}
          athletes={athletes}
          exercises={exercises}
          sessionGroups={sessionGroups}
          scopeAthleteId={currentAthleteId}
          scopeAthlete={currentAthlete}
          anchorDate={date}
        />
      )}
    </div>
  );
};
