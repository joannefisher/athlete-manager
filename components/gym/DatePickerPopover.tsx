// components/gym/DatePickerPopover.tsx
// Reusable month-grid date-picker popover (Concept B's mini-calendar style
// from the UI 2 mockup review) — lets the user jump straight to any date
// instead of only stepping one day/week/month at a time via arrows. Opened
// by clicking a date label; closes on choosing a date, pressing Escape, or
// clicking outside.

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIso } from './WeekStrip';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_LABEL = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

function monthGridDates(monthCursor: Date): { iso: string; inMonth: boolean }[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return { iso: d.toISOString().split('T')[0], inMonth: d.getMonth() === month };
  });
}

export const DatePickerPopover = ({
  value,
  onChange,
  onClose,
  align = 'left',
}: {
  /** Currently selected date (yyyy-mm-dd) — the popover opens showing this date's month. */
  value: string;
  onChange: (date: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}) => {
  const [monthCursor, setMonthCursor] = useState(() => new Date(value + 'T00:00:00'));
  const ref = useRef<HTMLDivElement>(null);
  const today = todayIso();

  useEffect(() => {
    // 2026-09-04: this was previously a 'mousedown' listener, which fires
    // and closes the popover (via onClose -> setShowDatePicker(false))
    // *before* a same-gesture click on a sibling element — e.g. the day
    // stepper's own forward/back chevrons in GymUI2Root.tsx, which sit
    // right next to this popover's anchor button and are outside `ref` —
    // gets its own 'click' handled. That's a real race: whether the
    // chevron's click still lands after this popover unmounts partway
    // through the same click gesture is timing-dependent, so with the
    // popover open, a chevron tap could silently do nothing. Using 'click'
    // instead closes the popover only *after* React has already run the
    // chevron's own onClick (document is above React's root-container
    // listener in the bubble path, so document-level 'click' always fires
    // last), removing the race entirely.
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const shiftMonth = (delta: number) => {
    setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const dates = monthGridDates(monthCursor);

  return (
    <div
      ref={ref}
      className={`absolute top-full mt-1.5 z-30 w-64 bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button onClick={() => shiftMonth(-1)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] font-semibold text-slate-700">{MONTH_LABEL(monthCursor)}</span>
        <button onClick={() => shiftMonth(1)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 mb-1">
        {DAY_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[9.5px] font-semibold text-slate-400 py-0.5">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {dates.map(({ iso, inMonth }) => {
          const isSelected = iso === value;
          const isToday = iso === today;
          const dayNum = new Date(iso + 'T00:00:00').getDate();
          return (
            <button
              key={iso}
              onClick={() => {
                onChange(iso);
                onClose();
              }}
              className={`h-7 mx-auto w-7 flex items-center justify-center rounded text-[11.5px] transition-colors ${
                isSelected
                  ? 'bg-slate-900 text-white font-semibold'
                  : !inMonth
                  ? 'text-slate-300 hover:bg-slate-50'
                  : isToday
                  ? 'text-blue-600 font-semibold hover:bg-slate-100'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => {
          onChange(today);
          onClose();
        }}
        className="w-full mt-2 h-7 text-[11.5px] font-medium text-blue-600 hover:bg-blue-50 rounded"
      >
        Jump to today
      </button>
    </div>
  );
};
