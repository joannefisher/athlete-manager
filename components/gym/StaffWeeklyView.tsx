// components/gym/StaffWeeklyView.tsx
// Week-at-a-glance grid: athletes down the side, days across the top, so a
// coach can see who has a Gym session planned each day without opening
// each one. Click a day heading to jump into that day's roster; click a
// cell to open that athlete's session directly.

import React, { useEffect, useState, useCallback } from 'react';
import { HeartPulse, Loader2 } from 'lucide-react';
import type { GymAthlete as Athlete } from './types';
import type { GymSession } from './types';
import { fetchSessionsForDateRange } from './gymApi';
import { getWeekDates, todayIso } from './WeekStrip';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDayNum = (d: string) => new Date(d + 'T00:00:00').getDate();

export const StaffWeeklyView = ({
  selectedDate,
  clubId,
  athletes,
  activeAthleteId,
  rehabAthleteIds,
  onSelectDay,
  onOpenSession,
}: {
  selectedDate: string;
  clubId: string;
  athletes: Athlete[];
  activeAthleteId?: string | null;
  rehabAthleteIds?: Set<string>;
  onSelectDay: (date: string) => void;
  onOpenSession: (athleteId: string, date: string) => void;
}) => {
  const weekDates = getWeekDates(selectedDate);
  const today = todayIso();
  const [sessions, setSessions] = useState<GymSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchSessionsForDateRange(clubId, weekDates));
    } catch (err) {
      console.error('[StaffWeeklyView] failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  }, [clubId, weekDates.join(',')]);

  useEffect(() => { load(); }, [load]);

  const sessionFor = (athleteId: string, date: string) => sessions.find(s => s.athleteId === athleteId && s.date === date);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left font-semibold text-slate-500 px-3 py-2 sticky left-0 bg-white">Player</th>
              {weekDates.map((date, i) => (
                <th key={date} className="px-1 py-2">
                  <button onClick={() => onSelectDay(date)} className={`flex flex-col items-center mx-auto ${date === today ? 'text-blue-600' : 'text-slate-500'} hover:underline`}>
                    <span className="text-[10px] font-semibold">{DAY_LABELS[i]}</span>
                    <span className="text-[13px] font-bold">{fmtDayNum(date)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {athletes.map(athlete => (
              <tr key={athlete.id} className={athlete.id === activeAthleteId ? 'bg-blue-50/70' : undefined}>
                <td className={`px-3 py-2 font-medium whitespace-nowrap sticky left-0 ${athlete.id === activeAthleteId ? 'bg-blue-50/70 text-blue-700' : 'bg-white text-slate-700'}`}>
                  <span className="flex items-center gap-1">
                    {athlete.name}
                    {rehabAthleteIds?.has(athlete.id) && (
                      <span title="On the rehab plan this week"><HeartPulse className="w-3 h-3 text-rose-500 flex-shrink-0" /></span>
                    )}
                  </span>
                </td>
                {weekDates.map(date => {
                  const session = sessionFor(athlete.id, date);
                  const count = session?.items?.length ?? 0;
                  return (
                    <td key={date} className="text-center">
                      <button
                        onClick={() => onOpenSession(athlete.id, date)}
                        className={`w-7 h-7 rounded-full text-[11px] font-semibold flex items-center justify-center mx-auto ${
                          count > 0 ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-300 hover:bg-slate-100'
                        }`}
                        title={count > 0 ? `${count} item${count !== 1 ? 's' : ''}` : 'No session'}
                      >
                        {count > 0 ? count : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {athletes.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">No athletes yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
