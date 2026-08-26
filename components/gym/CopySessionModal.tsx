// components/gym/CopySessionModal.tsx
// "Copy session…" flow launched from SessionEditor: which items to copy is
// now decided one level up, in SessionEditor's own item list (its Select
// mode — see there), so this modal just receives that already-chosen set
// of items and picks who to copy them to (any number, hand-picked or
// unioned in from a saved group, pre-selected with the session's own
// athlete/group since that's the overwhelmingly common case — copying to a
// different date for the same person/group) and which date via a week
// strip with prev/next arrows. Can be run again for another destination;
// each run is independent and never overwrites what's already there at the
// destination. Pushes a single undo action that removes everything it just
// created.

import React, { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Users, X } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymExercise, GymSessionGroup, GymSessionItem } from './types';
import { copySessionItems, deleteSessionItem } from './gymApi';
import { useGymUndo } from './GymUndoContext';
import { getWeekDates } from './WeekStrip';
import { itemDisplayName } from './itemDisplay';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDayNum = (d: string) => new Date(d + 'T00:00:00').getDate();
const fmtWC = (d: string) => 'w/c ' + new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const shiftDate = (d: string, days: number) => {
  const dd = new Date(d + 'T00:00:00');
  dd.setDate(dd.getDate() + days);
  return dd.toISOString().split('T')[0];
};

export const CopySessionModal = ({
  items,
  exercises,
  sourceAthleteId,
  sourceGroupId,
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
  /** The group this session was created from (GymSession.sourceGroupId), if any — its members are pre-selected as destinations too. */
  sourceGroupId?: string | null;
  sourceDate: string;
  athletes: Athlete[];
  sessionGroups: GymSessionGroup[];
  clubId: string;
  userId: string;
  onClose: () => void;
}) => {
  const { pushUndo } = useGymUndo();
  // Destination defaults to the athlete (and, if this session came from one, the
  // whole group) the session is being copied FROM — copying to a different date
  // for the same person/group is by far the most common case.
  const [destAthleteIds, setDestAthleteIds] = useState<Set<string>>(() => {
    const initial = new Set<string>([sourceAthleteId]);
    if (sourceGroupId) {
      const group = sessionGroups.find(g => g.id === sourceGroupId);
      group?.memberAthleteIds.forEach(id => initial.add(id));
    }
    return initial;
  });
  const [groupToAdd, setGroupToAdd] = useState('');
  const [destDate, setDestDate] = useState(sourceDate);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekDates = getWeekDates(destDate);

  const toggleAthlete = (athleteId: string) => {
    setDestAthleteIds(prev => {
      const next = new Set(prev);
      next.has(athleteId) ? next.delete(athleteId) : next.add(athleteId);
      return next;
    });
  };

  const addGroupMembers = (groupId: string) => {
    setGroupToAdd('');
    const group = sessionGroups.find(g => g.id === groupId);
    if (!group) return;
    setDestAthleteIds(prev => new Set([...prev, ...group.memberAthleteIds]));
  };

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupId ?? null;

  const handleCopy = async () => {
    if (items.length === 0) {
      setError('Nothing selected to copy.');
      return;
    }
    if (destAthleteIds.size === 0) {
      setError('Select at least one player to copy to.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const destinations = Array.from(destAthleteIds).map(athleteId => ({ athleteId, date: destDate }));
      const results = await copySessionItems(items, destinations, exerciseGroupIdFor, clubId, userId);
      const names = Array.from(destAthleteIds).map(id => athletes.find(a => a.id === id)?.name).filter(Boolean);
      const dateLabel = new Date(destDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      setDone(`Copied ${items.length} item${items.length !== 1 ? 's' : ''} to ${names.length} player${names.length !== 1 ? 's' : ''} for ${dateLabel}.`);
      pushUndo({
        label: `Undo copy to ${names.length} player${names.length !== 1 ? 's' : ''}`,
        run: async () => {
          for (const r of results) for (const item of r.items) await deleteSessionItem(item.id);
        },
      });
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
          {/* What's being copied — chosen up front via SessionEditor's own Select mode */}
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-32 overflow-y-auto bg-slate-50/60">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-white border-b border-slate-100">
              Copying {items.length} item{items.length !== 1 ? 's' : ''}
            </div>
            {items.map(item => (
              <div key={item.id} className="px-3 py-1.5 text-[12.5px] text-slate-700">
                {item.itemType === 'exercise' ? itemDisplayName(item) : item.noteText}
              </div>
            ))}
            {items.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-slate-400">Nothing selected to copy.</div>}
          </div>

          {/* Destination players */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-slate-500">Copy to ({destAthleteIds.size} selected)</label>
              {sessionGroups.length > 0 && (
                <select
                  value={groupToAdd}
                  onChange={e => addGroupMembers(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50"
                >
                  <option value="">+ Add a group's players…</option>
                  {sessionGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.memberAthleteIds.length})</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 border border-slate-200 rounded-lg p-2 max-h-32 overflow-y-auto">
              {athletes.map(a => {
                const active = destAthleteIds.has(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAthlete(a.id)}
                    className={`text-[11px] px-2 py-1 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                  >
                    {a.name}{a.id === sourceAthleteId ? ' (source)' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Destination week + date */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Date</label>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1.5 bg-slate-50 border-b border-slate-100">
                <button onClick={() => setDestDate(shiftDate(destDate, -7))} className="p-1 rounded hover:bg-slate-200 text-slate-500">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-medium text-slate-500">{fmtWC(weekDates[0])}</span>
                <button onClick={() => setDestDate(shiftDate(destDate, 7))} className="p-1 rounded hover:bg-slate-200 text-slate-500">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-7 divide-x divide-slate-100">
                {weekDates.map((d, i) => {
                  const isActive = d === destDate;
                  return (
                    <button
                      key={d}
                      onClick={() => setDestDate(d)}
                      className={`flex flex-col items-center py-2 ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-600'}`}
                    >
                      <span className={`text-[9px] font-semibold ${isActive ? 'text-white/60' : 'text-slate-400'}`}>{DAY_LABELS[i]}</span>
                      <span className="text-[13px] font-bold leading-tight">{fmtDayNum(d)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}
          {done && <p className="text-[12px] text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {done}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCopy}
              disabled={saving}
              className="flex-1 h-9 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
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
