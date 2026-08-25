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
import { AlertTriangle, ArrowLeft, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
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
      await setSessionGroupMembers(groupId, group.memberAthleteIds.filter(id => !removeIds.includes(id)));
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
      await setSessionGroupMembers(groupId, members);
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

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <button onClick={handleBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <h2 className="text-[15px] font-bold text-slate-900 mb-3">Gym groups</h2>

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-3">
        {sessionGroups.map(group => {
          const isEditing = editingGroupId === group.id;
          const memberCount = isEditing ? editingMembers.length : group.memberAthleteIds.length;
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
