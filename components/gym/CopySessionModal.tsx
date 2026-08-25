// components/gym/CopySessionModal.tsx
// "Copy session…" flow launched from SessionEditor: pick which items to
// copy (everything by default, or a subset — with an "only what I added"
// shortcut), then pick a destination — a single athlete on any date, or a
// whole gym group on a date — and copy. Can be run again for another
// destination; each run is independent and never overwrites what's already
// there at the destination.

import React, { useState } from 'react';
import { Check, Loader2, User, Users, X } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymSessionGroup, GymSessionItem } from './types';
import { copySessionItems } from './gymApi';

type DestinationMode = 'athlete' | 'group';

export const CopySessionModal = ({
  items,
  exercises,
  sourceAthleteId,
  sourceDate,
  athletes,
  sessionGroups,
  clubId,
  userId,
  onClose,
}: {
  items: GymSessionItem[];
  exercises: GymExercise[];
  sourceAthleteId: string;
  sourceDate: string;
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  clubId: string;
  userId: string;
  onClose: () => void;
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(items.map(i => i.id)));
  const [mode, setMode] = useState<DestinationMode>('athlete');
  const [destAthleteId, setDestAthleteId] = useState('');
  const [destGroupId, setDestGroupId] = useState('');
  const [destDate, setDestDate] = useState(sourceDate);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectOnlyMine = () => {
    setSelectedIds(new Set(items.filter(i => i.createdBy === userId).map(i => i.id)));
  };
  const selectAll = () => setSelectedIds(new Set(items.map(i => i.id)));

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupId ?? null;

  const handleCopy = async () => {
    const selectedItems = items.filter(i => selectedIds.has(i.id));
    if (selectedItems.length === 0) {
      setError('Select at least one item to copy.');
      return;
    }
    let destinations: { athleteId: string; date: string }[] = [];
    if (mode === 'athlete') {
      if (!destAthleteId || !destDate) {
        setError('Choose a player and a date.');
        return;
      }
      destinations = [{ athleteId: destAthleteId, date: destDate }];
    } else {
      const group = sessionGroups.find(g => g.id === destGroupId);
      if (!group || group.memberAthleteIds.length === 0 || !destDate) {
        setError('Choose a group (with players in it) and a date.');
        return;
      }
      destinations = group.memberAthleteIds.map(athleteId => ({ athleteId, date: destDate }));
    }

    setError(null);
    setSaving(true);
    try {
      await copySessionItems(selectedItems, destinations, exerciseGroupIdFor, clubId, userId);
      const who = mode === 'athlete' ? athletes.find(a => a.id === destAthleteId)?.name : sessionGroups.find(g => g.id === destGroupId)?.name;
      setDone(`Copied ${selectedItems.length} item${selectedItems.length !== 1 ? 's' : ''} to ${who || 'the destination'} for ${new Date(destDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`);
    } catch (err: any) {
      console.error('[CopySessionModal] copy failed', err);
      setError(err?.message || 'Failed to copy session.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-[14px] font-bold text-slate-900">Copy session</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Item selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-slate-500">What to copy</label>
              <div className="flex items-center gap-2 text-[11px]">
                <button onClick={selectAll} className="text-blue-600 hover:underline">All</button>
                <button onClick={selectOnlyMine} className="text-blue-600 hover:underline">Only items I added</button>
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
              {items.map(item => (
                <label key={item.id} className="flex items-start gap-2 px-3 py-2 text-[13px] cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleItem(item.id)} className="mt-0.5 w-3.5 h-3.5" />
                  <span className="flex-1 min-w-0">
                    <span className="text-slate-800">
                      {item.itemType === 'exercise' ? (item.effectiveExerciseName || item.exerciseName) : item.noteText}
                    </span>
                    {item.createdByName && <span className="block text-[10px] text-slate-400">added by {item.createdByName}</span>}
                  </span>
                </label>
              ))}
              {items.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-slate-400">Nothing to copy yet.</div>}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Copy to</label>
            <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium w-fit mb-2">
              <button onClick={() => setMode('athlete')} className={`px-2.5 py-1 rounded flex items-center gap-1 ${mode === 'athlete' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                <User className="w-3 h-3" /> Player
              </button>
              <button onClick={() => setMode('group')} className={`px-2.5 py-1 rounded flex items-center gap-1 ${mode === 'group' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                <Users className="w-3 h-3" /> Group
              </button>
            </div>

            {mode === 'athlete' ? (
              <select
                value={destAthleteId}
                onChange={e => setDestAthleteId(e.target.value)}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 mb-2"
              >
                <option value="">Select a player…</option>
                {athletes.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.id === sourceAthleteId ? ' (this player)' : ''}</option>
                ))}
              </select>
            ) : (
              <select
                value={destGroupId}
                onChange={e => setDestGroupId(e.target.value)}
                className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50 mb-2"
              >
                <option value="">Select a group…</option>
                {sessionGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.memberAthleteIds.length} players)</option>
                ))}
              </select>
            )}

            <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
            <input
              type="date"
              value={destDate}
              onChange={e => setDestDate(e.target.value)}
              className="w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-slate-50"
            />
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}
          {done && <p className="text-[12px] text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {done}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCopy}
              disabled={saving}
              className="flex-1 h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Copy
            </button>
            <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg">
              {done ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
