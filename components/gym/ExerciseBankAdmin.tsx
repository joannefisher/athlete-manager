// components/gym/ExerciseBankAdmin.tsx
// Admin management for the Gym exercise bank: the editable list of
// exercise-group "types" (Anterior/Posterior + whatever else gets added
// later), the exercise groups themselves (e.g. "Squat", "Hinge"), and the
// exercise bank (individual exercises, each belonging to one group).
// Rendered as three collapsible cards inside Gym's own "Exercise Bank" tab.
// Read-only (no Add/Edit/Delete controls) when canEdit is false.

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Edit2, Plus, Trash2 } from 'lucide-react';
import {
  fetchExerciseGroupTypes,
  createExerciseGroupType,
  fetchExerciseGroups,
  createExerciseGroup,
  updateExerciseGroup,
  deleteExerciseGroup,
  fetchExercises,
  createExercise,
} from './gymApi';
import type { GymExercise, GymExerciseGroup, GymExerciseGroupType } from './types';
import type { Role } from '../AthleteManager';
import { ExerciseReviewPanel } from './ExerciseReviewPanel';

export const ExerciseBankAdmin = ({ clubId, currentUserId, canEdit, role }: { clubId: string; currentUserId: string; canEdit: boolean; role: Role }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [types, setTypes] = useState<GymExerciseGroupType[]>([]);
  const [groups, setGroups] = useState<GymExerciseGroup[]>([]);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [newTypeName, setNewTypeName] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupTypeId, setNewGroupTypeId] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupData, setEditGroupData] = useState<{ name: string; typeId: string }>({ name: '', typeId: '' });
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseGroupId, setNewExerciseGroupId] = useState('');

  const load = useCallback(async () => {
    const [t, g, e] = await Promise.all([fetchExerciseGroupTypes(clubId), fetchExerciseGroups(clubId), fetchExercises(clubId)]);
    setTypes(t);
    setGroups(g);
    setExercises(e);
    setLoaded(true);
  }, [clubId]);

  useEffect(() => {
    if (expanded && !loaded) load();
  }, [expanded, loaded, load]);

  const toggle = (key: string) => setExpanded(expanded === key ? null : key);

  return (
    <>
      {/* Exercise group types */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => toggle('types')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div>
            <h3 className="font-semibold text-sm text-left">Gym: Exercise Group Types</h3>
            <p className="text-xs text-slate-500">{types.length} types (e.g. Anterior / Posterior)</p>
          </div>
          {expanded === 'types' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'types' && (
          <div className="border-t">
            {types.map(t => (
              <div key={t.id} className="p-3 border-b last:border-b-0 text-sm">{t.name}</div>
            ))}
            {canEdit && (
              <div className="p-3 border-t flex gap-2">
                <input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="New type name"
                  className="flex-1 px-2 py-1.5 text-sm border rounded" />
                <button
                  onClick={async () => { if (!newTypeName.trim()) return; await createExerciseGroupType(clubId, newTypeName.trim()); setNewTypeName(''); load(); }}
                  className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-medium"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exercise groups */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mt-3">
        <button onClick={() => toggle('groups')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div>
            <h3 className="font-semibold text-sm text-left">Gym: Exercise Groups</h3>
            <p className="text-xs text-slate-500">{groups.length} groups</p>
          </div>
          {expanded === 'groups' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'groups' && (
          <div className="border-t">
            {groups.map(g => (
              <div key={g.id} className="p-3 border-b last:border-b-0">
                {editingGroupId === g.id ? (
                  <div className="space-y-2">
                    <input value={editGroupData.name} onChange={e => setEditGroupData(d => ({ ...d, name: e.target.value }))} className="w-full px-2 py-1 text-sm border rounded" />
                    <select value={editGroupData.typeId} onChange={e => setEditGroupData(d => ({ ...d, typeId: e.target.value }))} className="w-full px-2 py-1 text-sm border rounded">
                      <option value="">No type</option>
                      {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => { await updateExerciseGroup(g.id, editGroupData.name, editGroupData.typeId || null); setEditingGroupId(null); load(); }}
                        className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingGroupId(null)} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{g.name} {g.typeName && <span className="text-xs text-slate-400">({g.typeName})</span>}</span>
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingGroupId(g.id); setEditGroupData({ name: g.name, typeId: g.typeId || '' }); }} className="p-1 hover:bg-slate-100 rounded">
                          <Edit2 className="w-4 h-4 text-slate-500" />
                        </button>
                        <button
                          onClick={async () => { if (!window.confirm('Delete this group? Exercises in it will need reassigning first.')) return; await deleteExerciseGroup(g.id); load(); }}
                          className="p-1 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {canEdit && (showAddGroup ? (
              <div className="p-3 border-t space-y-2">
                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name (e.g. Squat)" className="w-full px-2 py-1.5 text-sm border rounded" />
                <select value={newGroupTypeId} onChange={e => setNewGroupTypeId(e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                  <option value="">No type</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={async () => { if (!newGroupName.trim()) return; await createExerciseGroup(clubId, newGroupName.trim(), newGroupTypeId || null); setNewGroupName(''); setNewGroupTypeId(''); setShowAddGroup(false); load(); }}
                    className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs"
                  >
                    Add
                  </button>
                  <button onClick={() => setShowAddGroup(false)} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="p-3 border-t">
                <button onClick={() => setShowAddGroup(true)} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium">
                  <Plus className="w-4 h-4 inline mr-1" />Add Exercise Group
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Exercise bank */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mt-3">
        <button onClick={() => toggle('exercises')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div>
            <h3 className="font-semibold text-sm text-left">Gym: Exercise Bank</h3>
            <p className="text-xs text-slate-500">{exercises.length} exercises</p>
          </div>
          {expanded === 'exercises' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'exercises' && (
          <div className="border-t">
            {exercises.map(ex => (
              <div key={ex.id} className="p-3 border-b last:border-b-0 flex justify-between items-center">
                <span className="text-sm">
                  {ex.name} <span className="text-xs text-slate-400">({ex.exerciseGroupName})</span>
                  {ex.status === 'pending' && (
                    <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Pending review</span>
                  )}
                </span>
              </div>
            ))}
            {canEdit && (showAddExercise ? (
              <div className="p-3 border-t space-y-2">
                <input value={newExerciseName} onChange={e => setNewExerciseName(e.target.value)} placeholder="Exercise name" className="w-full px-2 py-1.5 text-sm border rounded" />
                <select value={newExerciseGroupId} onChange={e => setNewExerciseGroupId(e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                  <option value="">Select a group…</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!newExerciseName.trim() || !newExerciseGroupId) return;
                      await createExercise(clubId, newExerciseName.trim(), newExerciseGroupId, currentUserId);
                      setNewExerciseName('');
                      setNewExerciseGroupId('');
                      setShowAddExercise(false);
                      load();
                    }}
                    className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs"
                  >
                    Add
                  </button>
                  <button onClick={() => setShowAddExercise(false)} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="p-3 border-t">
                <button onClick={() => setShowAddExercise(true)} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium">
                  <Plus className="w-4 h-4 inline mr-1" />Add Exercise
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {role === 'Admin' && <ExerciseReviewPanel clubId={clubId} currentUserId={currentUserId} onChanged={load} />}
    </>
  );
};
