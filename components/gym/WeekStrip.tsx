// components/gym/WeekStrip.tsx
// Shared date navigator for the Gym module — a Day/Week toggle, a date
// picker that can jump to any month, a 7-day tab strip (same visual
// language as SessionPlanPage's week strip in AthleteManager.tsx), and a
// "Today" quick-return button so a coach who has wandered off to a distant
// week/day can always get back in one tap.

import React from 'react';
import { Calendar as CalendarIcon, RotateCcw } from 'lucide-react';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function getWeekDates(date: string): string[] {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay(); // 0 = Sunday
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7)); // week starts Monday, matches the rest of the app
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

const fmtDayNum = (d: string) => new Date(d + 'T00:00:00').getDate();
const fmtWC = (d: string) => {
  const mon = new Date(d + 'T00:00:00');
  return 'w/c ' + mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export type GymViewMode = 'day' | 'week';

export const WeekStrip = ({
  selectedDate,
  onDateChange,
  viewMode,
  onViewModeChange,
  countForDate,
  extraControls,
}: {
  selectedDate: string;
  onDateChange: (date: string) => void;
  viewMode: GymViewMode;
  onViewModeChange: (mode: GymViewMode) => void;
  /** Optional per-date badge count (e.g. number of sessions planned that day). */
  countForDate?: (date: string) => number;
  /** Optional extra control(s) rendered at the end of the Day/Week toolbar row — e.g. a compact player filter. */
  extraControls?: React.ReactNode;
}) => {
  const today = todayIso();
  const weekDates = getWeekDates(selectedDate);
  const isCurrentWeek = weekDates.includes(today);

  return (
    <div className="mb-3">
      {/* Day / Week toggle + date picker + Today */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 mb-3 flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded-md p-0.5 text-[12px] font-medium">
          <button
            onClick={() => onViewModeChange('day')}
            className={`px-2.5 py-1 rounded ${viewMode === 'day' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            Day
          </button>
          <button
            onClick={() => onViewModeChange('week')}
            className={`px-2.5 py-1 rounded ${viewMode === 'week' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
          >
            Week
          </button>
        </div>

        <div className="relative flex-1">
          <CalendarIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => onDateChange(e.target.value)}
            className="w-full h-8 pl-7 pr-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={() => onDateChange(today)}
          disabled={selectedDate === today}
          title="Jump back to today"
          className="h-8 px-2.5 flex items-center gap-1 text-[12px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap"
        >
          <RotateCcw className="w-3 h-3" /> Today
        </button>

        {extraControls}
      </div>

      {/* 7-day tab strip */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="text-[11px] text-slate-400">{fmtWC(weekDates[0])}</span>
          {!isCurrentWeek && (
            <button onClick={() => onDateChange(today)} className="text-[11px] text-blue-600 hover:underline">
              back to this week
            </button>
          )}
        </div>
        <div className="grid grid-cols-7 divide-x divide-slate-100 mt-1.5">
          {weekDates.map((date, i) => {
            const isActive = date === selectedDate;
            const isToday = date === today;
            const count = countForDate?.(date) ?? 0;
            return (
              <button
                key={date}
                onClick={() => onDateChange(date)}
                className={`flex flex-col items-center py-2.5 px-1 transition-colors ${
                  isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-600'
                }`}
              >
                <span className={`text-[10px] font-semibold ${isActive ? 'text-white/60' : 'text-slate-400'}`}>{DAY_LABELS[i]}</span>
                <span className={`text-[15px] font-bold leading-tight ${isToday && !isActive ? 'text-blue-600' : ''}`}>{fmtDayNum(date)}</span>
                {count > 0 && (
                  <span className={`mt-1 text-[9px] px-1.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
