// components/gym/GroupPicker.tsx
// Create and manage gym-only player groups (independent of team_structure).
// Used from StaffDailyView's "Manage groups" button and to build the list
// offered by "Assign to group…".

import React, { useState } from 'react';
import { ArrowLeft, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { Athlete } from '../AthleteManager';
import type { GymSessionGroup } from './types';
import { createSessionGroup, setSessionGroupMembers, deleteSessionGroup } from './gymApi';

export const GroupPicker = ({
  clubId,
  userId,
  athletes,
  sessionGroups,
  onChanged,
  onBack,
}: {
  clubId: string;
  userId: string;
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  onChanged: () => void;
  onBack: () => void;
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleMember = (list: string[], setList: (v: string[]) => void, athleteId: string) => {
    setList(list.includes(athleteId) ? list.filter(id => id !== athleteId) : [...list, athleteId]);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createSessionGroup(clubId, newName.trim(), newMembers, userId);
      setNewName('');
      setNewMembers([]);
      setCreating(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateMembers = async (group: GymSessionGroup, members: string[]) => {
    setSaving(true);
    try {
      await setSessionGroupMembers(group.id, members);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!window.confirm('Delete this group? Sessions already assigned to its members are not affected.')) return;
    await deleteSessionGroup(groupId);
    onChanged();
  };

  return (
    <div className="max-w-md md:max-w-2xl mx-auto p-4 md:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <h2 className="text-[15px] font-bold text-slate-900 mb-3">Gym groups</h2>

      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-3">
        {sessionGroups.map(group => (
          <div key={group.id} className="p-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-medium text-slate-800">{group.name}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingGroupId(editingGroupId === group.id ? null : group.id)}
                  className="text-[12px] text-blue-600 hover:underline"
                >
                  {editingGroupId === group.id ? 'Done' : `${group.memberAthleteIds.length} players`}
                </button>
                <button onClick={() => handleDelete(group.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {editingGroupId === group.id && (
              <div className="flex flex-wrap gap-1.5">
                {athletes.map(a => {
                  const active = group.memberAthleteIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        const next = active ? group.memberAthleteIds.filter(id => id !== a.id) : [...group.memberAthleteIds, a.id];
                        handleUpdateMembers(group, next);
                      }}
                      disabled={saving}
                      className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
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
          <div className="flex flex-wrap gap-1.5 mb-3">
            {athletes.map(a => {
              const active = newMembers.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleMember(newMembers, setNewMembers, a.id)}
                  className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                >
                  {a.name}
                </button>
              );
            })}
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
    </div>
  );
};
