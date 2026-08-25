// components/gym/GymUI2GroupCompare.tsx
// UI 2 "All players" mode — Compare tab. Only the "same weekday, past
// weeks" comparison applies here — there's no single "player" to stack
// against others when the scope is the whole group. Each column shows the
// group's shared plan for that date only, never any one member's own
// modifications or additions, per Joanne's ask.

import React, { useEffect, useState, useCallback } from 'react';
import { Copy, Loader2, StickyNote } from 'lucide-react';
import type { GymExercise, GymGroupPlanItem, GymSessionGroup } from './types';
import { fetchGroupPlansForDateRange, copyGroupPlanItems, deleteGroupPlanItemsAndSynced } from './gymApi';
import { useGymUndo } from './GymUndoContext';
import { itemCompactLabel } from './itemDisplay';

const WEEKS_BACK = 4;

const shiftDate = (d: string, days: number) => {
  const dd = new Date(d + 'T00:00:00');
  dd.setDate(dd.getDate() + days);
  return dd.toISOString().split('T')[0];
};
const fmtColHeader = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const PlanColumn = ({
  title,
  subtitle,
  items,
  emptyLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  items: GymGroupPlanItem[];
  emptyLabel: string;
  action?: React.ReactNode;
}) => (
  <div className="flex-1 min-w-[190px] border border-slate-200 rounded-lg overflow-hidden bg-white">
    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-slate-800 truncate">{title}</div>
        {subtitle && <div className="text-[10.5px] text-slate-400">{subtitle}</div>}
      </div>
      {action}
    </div>
    <div className="p-2 space-y-1 max-h-[420px] overflow-y-auto">
      {items.length === 0 && <div className="text-[11.5px] text-slate-400 italic px-1 py-2">{emptyLabel}</div>}
      {items.map(item => (
        <div
          key={item.id}
          className={`text-[11.5px] leading-snug px-2 py-1 rounded ${
            item.itemType === 'note' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {item.itemType === 'note' ? (
            <span className="flex items-start gap-1">
              <StickyNote className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{item.noteText}</span>
            </span>
          ) : (
            itemCompactLabel(item)
          )}
        </div>
      ))}
    </div>
  </div>
);

export const GymUI2GroupCompare = ({
  group,
  clubId,
  userId,
  canEdit,
  exercises,
  anchorDate,
}: {
  group: GymSessionGroup;
  clubId: string;
  userId: string;
  canEdit: boolean;
  exercises: GymExercise[];
  anchorDate: string;
}) => {
  const { pushUndo } = useGymUndo();
  const [itemsByDate, setItemsByDate] = useState<Map<string, GymGroupPlanItem[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const columns = Array.from({ length: WEEKS_BACK }, (_, i) => shiftDate(anchorDate, -7 * (WEEKS_BACK - 1 - i)));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItemsByDate(await fetchGroupPlansForDateRange(group.id, columns));
    } catch (err) {
      console.error('[GymUI2GroupCompare] failed to load weekday comparison', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, anchorDate]);

  useEffect(() => { load(); }, [load]);

  const exerciseGroupIdFor = (exerciseId: string) => exercises.find(e => e.id === exerciseId)?.exerciseGroupId ?? null;

  const handleCopyToThisWeek = async (sourceItems: GymGroupPlanItem[]) => {
    if (!sourceItems || sourceItems.length === 0) return;
    try {
      const results = await copyGroupPlanItems(sourceItems, [{ date: anchorDate }], clubId, group.id, group.memberAthleteIds, exerciseGroupIdFor, userId);
      await load();
      const createdIds = results.flatMap(r => r.items.map(i => i.id));
      pushUndo({
        label: `Undo copy to ${new Date(anchorDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        run: async () => {
          await deleteGroupPlanItemsAndSynced(createdIds, clubId, group.id, group.memberAthleteIds, anchorDate);
          await load();
        },
      });
    } catch (err) {
      console.error('[GymUI2GroupCompare] copy to this week failed', err);
      window.alert('Could not copy that plan — please try again.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-slate-400">
          {group.name}'s shared plan across the last {WEEKS_BACK} occurrences of this weekday — individual player customizations aren't shown here.
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {columns.map((date, i) => {
          const items = itemsByDate.get(date) || [];
          const isCurrent = date === anchorDate;
          return (
            <PlanColumn
              key={date}
              title={fmtColHeader(date)}
              subtitle={isCurrent ? 'This week' : `${WEEKS_BACK - 1 - i} week${WEEKS_BACK - 1 - i !== 1 ? 's' : ''} ago`}
              items={items}
              emptyLabel="No plan"
              action={
                canEdit && !isCurrent && items.length > 0 ? (
                  <button
                    onClick={() => handleCopyToThisWeek(items)}
                    title="Copy to this week"
                    className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
};
