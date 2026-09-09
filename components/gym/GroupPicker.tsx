// components/gym/GroupPicker.tsx
// Create and manage gym-only player groups (independent of team_structure).
// Used from StaffDailyView's "Manage groups" button and to build the list
// offered by "Assign to group…".
//
// Position name / position-group filters above the athlete pill grid mirror
// TrainingPlanner.tsx's HomePage filter exactly (uniquePositionNames /
// toggleGroup / togglePositionName) — they narrow which pills are shown to
// make a big roster faster to pick from; they don't bulk-select anyone, so
// an athlete already picked stays picked even if a filter hides their pill.
//
// Editing a group's members batches changes locally (editingMembers) and
// only calls the API once, on "Done" or on navigating back while mid-edit —
// not on every pill click.

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import type { GymAthlete as Athlete, GymTeamPosition } from './types';
import type { GymSessionGroup } from './types';
import { createSessionGroup, setSessionGroupMembers, deleteSessionGroup } from './gymApi';

const usePositionFilter = (athletes: Athlete[], teamStructure: GymTeamPosition[]) => {
  const [selectedGroups, setSelectedGroups] = useState<string[]>(['Forward', 'Back']);
  const [selectedPositionNames, setSelectedPositionNames] = useState<string[]>([]);

  const uniquePositionNames = useMemo(() => {
    const names = new Map<string, { name: string; numbers: number[]; group: string }>();
    athletes.forEach(a => {
      (a.positionNumbers || []).forEach(posNum => {
        const pos = teamStructure.find(p => p.number === posNum);
        if (pos && !names.has(pos.name)) names.set(pos.name, { name: pos.name, numbers: [], group: pos.group });
        if (pos) names.get(pos.name)!.numbers.push(posNum);
      });
    });
    return Array.from(names.values());
  }, [athletes, teamStructure]);

  const toggleGroup = (group: string) => {
    const groupPositionNames = uniquePositionNames.filter(p => p.group === group).map(p => p.name);
    if (selectedGroups.includes(group)) {
      setSelectedGroups(prev => prev.filter(g => g !== group));
      setSelectedPositionNames(prev => prev.filter(n => !groupPositionNames.includes(n)));
    } else {
      setSelectedGroups(prev => [...prev, group]);
    }
  };

  const togglePositionName = (posName: string) => {
    setSelectedPositionNames(prev => prev.includes(posName) ? prev.filter(n => n !== posName) : [...prev, posName]);
  };

  const visibleAthletes = athletes.filter(a => {
    if (selectedGroups.length >= 2 && selectedPositionNames.length === 0) return true;
    const posNames = (a.positionNumbers || []).map(n => teamStructure.find(p => p.number === n)?.name).filter(Boolean);
    const groups = (a.positionNumbers || []).map(n => teamStructure.find(p => p.number === n)?.group).filter(Boolean);
    if (selectedPositionNames.length > 0 && !posNames.some(n => selectedPositionNames.includes(n as string))) return false;
    if (selectedGroups.length < 2 && !groups.some(g => selectedGroups.includes(g as string))) return false;
    return true;
  });

  return { selectedGroups, selectedPositionNames, uniquePositionNames, toggleGroup, togglePositionName, visibleAthletes };
};

const PositionFilterRow = ({
  selectedGroups,
  selectedPositionNames,
  uniquePositionNames,
  toggleGroup,
  togglePositionName,
}: {
  selectedGroups: string[];
  selectedPositionNames: string[];
  uniquePositionNames: { name: string; numbers: number[]; group: string }[];
  toggleGroup: (group: string) => void;
  togglePositionName: (posName: string) => void;
}) => (
  <div className="flex flex-wrap gap-3 items-center mb-2">
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-slate-400">Group</span>
      <div className="flex gap-1">
        {['Forward', 'Back'].map(group => (
          <button
            key={group}
            onClick={() => toggleGroup(group)}
            className={`h-5 px-2 rounded text-[10px] font-medium border transition-colors ${selectedGroups.includes(group) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
          >
            {group}s
          </button>
        ))}
      </div>
    </div>
    {uniquePositionNames.length > 0 && (
      <div className="flex items-start gap-1.5">
        <span className="text-[10px] font-medium text-slate-400 mt-0.5">Position</span>
        <div className="flex flex-wrap gap-1">
          {uniquePositionNames.map(pos => (
            <button
              key={pos.name}
              onClick={() => togglePositionName(pos.name)}
              className={`h-5 px-1.5 rounded text-[10px] border transition-colors ${selectedPositionNames.includes(pos.name) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
            >
              {pos.name}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);

export const GroupPicker = ({
  clubId,
  userId,
  athletes,
  teamStructure,
  sessionGroups,
  onChanged,
  onBack,
}: {
  clubId: string;
  userId: string;
  athletes: Athlete[];
  teamStructure: GymTeamPosition[];
  sessionGroups: GymSessionGroup[];
  onChanged: () => void;
  onBack: () => void;
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingMembers, setEditingMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Round 30 — a second, player-first view of the exact same data: one row
  // per player with their current group in a dropdown, instead of one
  // section per group with a pill grid. Both views read/write the same
  // sessionGroups, so nothing about how groups themselves work changes —
  // this is just an alternate way to see and edit the same assignments,
  // toggled per Joanne's ask ("existing UI should remain as well as a
  // toggle"). Defaults to the existing Groups view.
  const [viewMode, setViewMode] = useState<'groups' | 'players'>('groups');
  const [playerSearch, setPlayerSearch] = useState('');
  const [movingAthleteId, setMovingAthleteId] = useState<string | null>(null);
  const [playerRowMessage, setPlayerRowMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const playerViewFilter = usePositionFilter(athletes, teamStructure);

  // A player can only belong to one gym group at a time. Adding someone
  // who's already in a different group is allowed, but only after they
  // confirm the reassignment (naming the group they'll be removed from) —
  // the actual removal from their old group is queued here and applied
  // alongside the add, at the same point the add itself is committed
  // (Done / Create group), not on every pill click.
  const [pendingCrossRemovals, setPendingCrossRemovals] = useState<{ athleteId: string; fromGroupId: string }[]>([]);
  const [confirmReassign, setConfirmReassign] = useState<{
    athleteId: string;
    athleteName: string;
    fromGroupId: string;
    fromGroupName: string;
    target: 'new' | 'editing';
  } | null>(null);

  const newGroupFilter = usePositionFilter(athletes, teamStructure);
  const editFilter = usePositionFilter(athletes, teamStructure);

  const findCurrentGroup = (athleteId: string, excludeGroupId: string | null) =>
    sessionGroups.find(g => g.id !== excludeGroupId && g.memberAthleteIds.includes(athleteId));

  const toggleMember = (
    list: string[],
    setList: (v: string[]) => void,
    athleteId: string,
    athleteName: string,
    excludeGroupId: string | null,
    target: 'new' | 'editing'
  ) => {
    if (list.includes(athleteId)) {
      setList(list.filter(id => id !== athleteId));
      setPendingCrossRemovals(prev => prev.filter(p => p.athleteId !== athleteId));
      return;
    }
    const current = findCurrentGroup(athleteId, excludeGroupId);
    if (current) {
      setConfirmReassign({ athleteId, athleteName, fromGroupId: current.id, fromGroupName: current.name, target });
      return;
    }
    setList([...list, athleteId]);
  };

  const confirmReassignment = () => {
    if (!confirmReassign) return;
    const { athleteId, fromGroupId, target } = confirmReassign;
    if (target === 'new') setNewMembers(prev => [...prev, athleteId]);
    else setEditingMembers(prev => [...prev, athleteId]);
    setPendingCrossRemovals(prev => [...prev, { athleteId, fromGroupId }]);
    setConfirmReassign(null);
  };

  /** Removes each queued reassignment's athlete from their old group's member list — run once, alongside the add itself. */
  const applyCrossRemovals = async (relevantAthleteIds: string[]) => {
    const relevant = pendingCrossRemovals.filter(p => relevantAthleteIds.includes(p.athleteId));
    if (relevant.length === 0) return;
    const byGroup = new Map<string, string[]>();
    for (const r of relevant) {
      if (!byGroup.has(r.fromGroupId)) byGroup.set(r.fromGroupId, []);
      byGroup.get(r.fromGroupId)!.push(r.athleteId);
    }
    for (const [groupId, removeIds] of byGroup) {
      const group = sessionGroups.find(g => g.id === groupId);
      if (!group) continue;
      await setSessionGroupMembers(groupId, group.memberAthleteIds.filter(id => !removeIds.includes(id)), userId);
    }
    setPendingCrossRemovals(prev => prev.filter(p => !relevantAthleteIds.includes(p.athleteId)));
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createSessionGroup(clubId, newName.trim(), newMembers, userId);
      await applyCrossRemovals(newMembers);
      setNewName('');
      setNewMembers([]);
      setCreating(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const commitMemberEdits = async (groupId: string, members: string[]) => {
    setSaving(true);
    try {
      await setSessionGroupMembers(groupId, members, userId);
      await applyCrossRemovals(members);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (group: GymSessionGroup) => {
    setEditingGroupId(group.id);
    setEditingMembers(group.memberAthleteIds);
  };

  const finishEditing = async () => {
    if (!editingGroupId) return;
    const groupId = editingGroupId;
    const members = editingMembers;
    setEditingGroupId(null);
    setEditingMembers([]);
    await commitMemberEdits(groupId, members);
  };

  // Navigating back while a group is mid-edit saves the pending changes
  // first, per feedback — "navigating back or clicking Done saves the changes."
  const handleBack = async () => {
    if (editingGroupId) {
      await finishEditing();
    }
    onBack();
  };

  const handleDelete = async (groupId: string) => {
    if (!window.confirm('Delete this group? Sessions already assigned to its members are not affected.')) return;
    if (editingGroupId === groupId) {
      setEditingGroupId(null);
      setEditingMembers([]);
    }
    await deleteSessionGroup(groupId);
    onChanged();
  };

  // Player-view equivalent of toggleMember + commitMemberEdits/applyCrossRemovals
  // combined: the dropdown's own current value already tells you where the
  // player is coming from, so there's no ambiguity to confirm — just remove
  // them from their old group (if any) and add them to the new one (if any
  // was chosen; empty = unassigned) in one go.
  const movePlayerToGroup = async (athleteId: string, athleteName: string, newGroupId: string) => {
    const currentGroup = sessionGroups.find(g => g.memberAthleteIds.includes(athleteId));
    if ((currentGroup?.id || '') === newGroupId) return;
    setMovingAthleteId(athleteId);
    try {
      if (currentGroup) {
        await setSessionGroupMembers(currentGroup.id, currentGroup.memberAthleteIds.filter(id => id !== athleteId), userId);
      }
      if (newGroupId) {
        const target = sessionGroups.find(g => g.id === newGroupId);
        if (target) await setSessionGroupMembers(newGroupId, [...target.memberAthleteIds, athleteId], userId);
      }
      setPlayerRowMessage({ id: athleteId, text: newGroupId ? `Moved to ${sessionGroups.find(g => g.id === newGroupId)?.name || 'group'}` : `Removed from ${currentGroup?.name || 'group'}` });
      setTimeout(() => setPlayerRowMessage(cur => (cur?.id === athleteId ? null : cur)), 3000);
      onChanged();
    } catch (err: any) {
      setPlayerRowMessage({ id: athleteId, text: err?.message || 'Failed to move this player', error: true });
    } finally {
      setMovingAthleteId(null);
    }
  };

  return (
    <div className="w-full p-4 md:p-6 space-y-3">
      <button onClick={handleBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[15px] font-bold text-slate-900">Gym groups</h2>
        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium">
          <button
            onClick={() => setViewMode('groups')}
            className={`px-3 py-1.5 rounded ${viewMode === 'groups' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            By group
          </button>
          <button
            onClick={() => setViewMode('players')}
            className={`px-3 py-1.5 rounded ${viewMode === 'players' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            By player
          </button>
        </div>
      </div>

      {viewMode === 'players' && (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5 mb-3">
          <div className="relative mb-2.5">
            <Search className="w-3.5 h-3.5 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search players by name…"
              value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <PositionFilterRow
            selectedGroups={playerViewFilter.selectedGroups}
            selectedPositionNames={playerViewFilter.selectedPositionNames}
            uniquePositionNames={playerViewFilter.uniquePositionNames}
            toggleGroup={playerViewFilter.toggleGroup}
            togglePositionName={playerViewFilter.togglePositionName}
          />
          {/* Round 33: rebuilt as a real <table> (was a CSS-grid stand-in —
              functionally fine, but visually its own one-off style next to
              GymSetup.tsx's player-defaults matrix, which is a real table).
              Header/body styling now matches the app's established table
              convention exactly (see TrainingPlanner.tsx's End of Day Report
              table, and GymSetup.tsx after this same round's pass over it):
              bg-slate-50/border-b header row, text-[10px]/slate-400/
              uppercase/tracking-wider column labels, divide-y body — and,
              like every other table in the app, scrolls horizontally on a
              narrow screen rather than stacking to one column, so this no
              longer has its own bespoke mobile behaviour either. Columns
              stay Player, then Group (column 2, per Joanne's ask), then
              Last modified pushed to the far right. */}
          <div className="-mx-3.5 mt-1 overflow-x-auto">
            <table className="min-w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-3.5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Player</th>
                  <th className="text-left px-3.5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Group</th>
                  <th className="text-right px-3.5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Last modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
            {playerViewFilter.visibleAthletes
              .filter(a => !playerSearch.trim() || a.name.toLowerCase().includes(playerSearch.trim().toLowerCase()))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(a => {
                const currentGroup = sessionGroups.find(g => g.memberAthleteIds.includes(a.id));
                const memberDetail = currentGroup?.memberDetails.find(m => m.athleteId === a.id);
                const msg = playerRowMessage?.id === a.id ? playerRowMessage : null;
                return (
                  <tr key={a.id}>
                    <td className="px-3.5 py-2 font-medium text-slate-800 whitespace-nowrap">{a.name}</td>
                    <td className="px-3.5 py-2">
                      <div className="relative inline-block">
                        <select
                          value={currentGroup?.id || ''}
                          disabled={movingAthleteId === a.id}
                          onChange={e => movePlayerToGroup(a.id, a.name, e.target.value)}
                          className="h-8 pl-2.5 pr-7 rounded-md border border-slate-200 bg-white text-[12px] font-medium text-slate-700 appearance-none disabled:opacity-40"
                        >
                          <option value="">— Unassigned —</option>
                          {sessionGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        {movingAthleteId === a.id
                          ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                          : <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                        }
                      </div>
                    </td>
                    <td className="px-3.5 py-2 text-right whitespace-nowrap">
                      {msg ? (
                        <span className={`text-[11px] ${msg.error ? 'text-red-600' : 'text-emerald-600'}`}>{msg.text}</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {memberDetail
                            ? <>Last modified by <span className="text-slate-500 font-medium">{memberDetail.addedByName || 'someone'}</span> on {new Date(memberDetail.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {playerViewFilter.visibleAthletes.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3.5 py-4 text-center text-slate-400">No players match the current filter.</td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'groups' && (
      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-3">
        {sessionGroups.map(group => {
          const isEditing = editingGroupId === group.id;
          const memberCount = isEditing ? editingMembers.length : group.memberAthleteIds.length;
          const members = isEditing
            ? []
            : group.memberAthleteIds.map(id => athletes.find(a => a.id === id)).filter(Boolean) as Athlete[];
          return (
            <div key={group.id} className="p-3.5">
              <div className="flex items-start justify-between">
                <p className="text-[13px] font-medium text-slate-800">{group.name}</p>
                <button onClick={() => handleDelete(group.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => (isEditing ? finishEditing() : startEditing(group))}
                disabled={saving}
                className="text-[12px] text-blue-600 hover:underline mt-0.5 disabled:opacity-40"
              >
                {isEditing ? 'Done' : `${memberCount} player${memberCount !== 1 ? 's' : ''}`}
              </button>
              {/* Read-only member names, shown with the extra width a full-page
                  layout provides (2026-09-03 fix — previously only the count
                  was visible unless you clicked into edit mode). Replaced by
                  the interactive/editable pill grid below while editing. */}
              {!isEditing && members.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {members.map(a => (
                    <span key={a.id} className="text-[11px] px-2 py-1 rounded-full border bg-slate-50 text-slate-500 border-slate-200">
                      {a.name}
                    </span>
                  ))}
                </div>
              )}
              {isEditing && (
                <div className="mt-2">
                  <PositionFilterRow
                    selectedGroups={editFilter.selectedGroups}
                    selectedPositionNames={editFilter.selectedPositionNames}
                    uniquePositionNames={editFilter.uniquePositionNames}
                    toggleGroup={editFilter.toggleGroup}
                    togglePositionName={editFilter.togglePositionName}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {editFilter.visibleAthletes.map(a => {
                      const active = editingMembers.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          onClick={() => toggleMember(editingMembers, setEditingMembers, a.id, a.name, group.id, 'editing')}
                          className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                        >
                          {a.name}
                        </button>
                      );
                    })}
                    {editFilter.visibleAthletes.length === 0 && (
                      <p className="text-[11px] text-slate-400 py-1">No players match the current filter.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {sessionGroups.length === 0 && !creating && <div className="p-6 text-center text-[13px] text-slate-400">No groups yet.</div>}
      </div>
      )}

      {creating ? (
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Group name</label>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Front row"
            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
          />
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Players</label>
          <PositionFilterRow
            selectedGroups={newGroupFilter.selectedGroups}
            selectedPositionNames={newGroupFilter.selectedPositionNames}
            uniquePositionNames={newGroupFilter.uniquePositionNames}
            toggleGroup={newGroupFilter.toggleGroup}
            togglePositionName={newGroupFilter.togglePositionName}
          />
          <div className="flex flex-wrap gap-1.5 mb-3">
            {newGroupFilter.visibleAthletes.map(a => {
              const active = newMembers.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleMember(newMembers, setNewMembers, a.id, a.name, null, 'new')}
                  className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                >
                  {a.name}
                </button>
              );
            })}
            {newGroupFilter.visibleAthletes.length === 0 && (
              <p className="text-[11px] text-slate-400 py-1">No players match the current filter.</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !newName.trim()} className="h-9 px-4 flex items-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold disabled:opacity-40">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Create group
            </button>
            <button onClick={() => { setCreating(false); setNewName(''); setNewMembers([]); }} className="h-9 px-3 text-[13px] text-slate-500 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full h-10 flex items-center justify-center gap-1.5 border border-dashed border-slate-300 rounded-lg text-[13px] font-medium text-slate-500 hover:bg-slate-50"
        >
          <Plus className="w-4 h-4" /> New group
        </button>
      )}

      {confirmReassign && (
        <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={() => setConfirmReassign(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-slate-700">
                <span className="font-semibold">{confirmReassign.athleteName}</span> is already in{' '}
                <span className="font-semibold">{confirmReassign.fromGroupName}</span>. A player can only be in one group at a time —
                continuing will remove them from {confirmReassign.fromGroupName}.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmReassignment}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800"
              >
                <Check className="w-3.5 h-3.5" /> Move them
              </button>
              <button onClick={() => setConfirmReassign(null)} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
