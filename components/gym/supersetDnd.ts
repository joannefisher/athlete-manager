// components/gym/supersetDnd.ts
// Shared drag-and-drop math for the "Superset" concept — a set of 2+
// exercises that must stay contiguous and be performed together, in order,
// within a session/plan. Each member keeps its own independent sets/reps/
// intensity; a superset itself has no attributes beyond the grouping key
// (`supersetId`, a plain uuid — no separate table). Used by both
// SessionEditor.tsx (an athlete's own session) and GroupPlanEditor.tsx (the
// "All players" shared group plan) so the merge/reorder rules behave
// identically in both places.
//
// Rendering model: a flat, sortOrder-ordered item array is grouped into
// contiguous runs sharing the same non-null supersetId (groupBySuperset).
// Each run renders as one visually-bordered block; every row inside it
// (and every standalone item) is its own drag source/drop target.
//
// Two ways to start a drag:
//   - a single row's own small grip: draggedIds = [that item's id]
//   - a superset block's group-level grip: draggedIds = every member's id,
//     keepTogether = true, so the whole block moves as one unit instead of
//     dissolving into standalone items when dropped at a new position.
//
// Each row is a drop target with three zones (top/middle/bottom third):
//   'before' / 'after' — plain reorder, same as today
//   'merge'            — join (or start) a superset with the row dropped on

export interface SupersetDraggable {
  id: string;
  supersetId: string | null;
}

export type DropZone = 'before' | 'merge' | 'after';

/** Which zone a drop at `offsetY` (px from the row's top) falls into, given the row's `height`. */
export function zoneForOffset(offsetY: number, height: number): DropZone {
  if (height <= 0) return 'merge';
  const ratio = offsetY / height;
  if (ratio < 1 / 3) return 'before';
  if (ratio > 2 / 3) return 'after';
  return 'merge';
}

export function newSupersetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID — still unique enough as a client-side grouping key.
  return `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface SupersetGroup<T extends SupersetDraggable> {
  supersetId: string | null; // null = a standalone (non-superset) item — `members` has exactly one entry
  members: T[];
}

/** Group a sortOrder-ordered item list into contiguous same-supersetId runs, for rendering. */
export function groupBySuperset<T extends SupersetDraggable>(items: T[]): SupersetGroup<T>[] {
  const groups: SupersetGroup<T>[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.supersetId) {
      const members = [item];
      let j = i + 1;
      while (j < items.length && items[j].supersetId === item.supersetId) {
        members.push(items[j]);
        j++;
      }
      groups.push({ supersetId: item.supersetId, members });
      i = j;
    } else {
      groups.push({ supersetId: null, members: [item] });
      i++;
    }
  }
  return groups;
}

/** A superset of exactly one member isn't a superset any more — un-group it. */
function dissolveSingleMemberGroups<T extends SupersetDraggable>(items: T[]): T[] {
  const groups = groupBySuperset(items);
  const result: T[] = [];
  for (const g of groups) {
    if (g.supersetId && g.members.length < 2) {
      for (const m of g.members) result.push({ ...m, supersetId: null });
    } else {
      result.push(...g.members);
    }
  }
  return result;
}

/**
 * Compute the new item order (and superset assignment) after dropping
 * `draggedIds` (kept in their existing relative order) onto `targetId` in
 * `zone`. `keepTogether` should be true only when the drag started from a
 * superset block's own group-level handle (see module doc above) — it keeps
 * multiple dragged items grouped together when moved to a new top-level
 * spot instead of dissolving them into standalone items.
 *
 * Returns null for a no-op drop (dropping a group onto one of its own
 * members, or onto itself).
 */
export function applySupersetDrop<T extends SupersetDraggable>(
  items: T[],
  draggedIds: string[],
  targetId: string,
  zone: DropZone,
  keepTogether: boolean
): T[] | null {
  if (draggedIds.length === 0 || draggedIds.includes(targetId)) return null;
  const draggedSet = new Set(draggedIds);
  const dragged = items.filter(i => draggedSet.has(i.id));
  if (dragged.length === 0) return null;
  const remaining = items.filter(i => !draggedSet.has(i.id));
  const targetIdx = remaining.findIndex(i => i.id === targetId);
  if (targetIdx === -1) return null;

  const draggedOriginalSupersetId = dragged[0].supersetId;
  const target = remaining[targetIdx];

  if (zone === 'merge') {
    const supersetId = target.supersetId || newSupersetId();
    let groupStart = targetIdx;
    let groupEnd = targetIdx;
    if (target.supersetId) {
      while (groupStart - 1 >= 0 && remaining[groupStart - 1].supersetId === target.supersetId) groupStart--;
      while (groupEnd + 1 < remaining.length && remaining[groupEnd + 1].supersetId === target.supersetId) groupEnd++;
    }
    const updatedRemaining = remaining.map((it, idx) => (idx >= groupStart && idx <= groupEnd ? { ...it, supersetId } : it));
    const updatedDragged = dragged.map(i => ({ ...i, supersetId }));
    const result = [...updatedRemaining.slice(0, groupEnd + 1), ...updatedDragged, ...updatedRemaining.slice(groupEnd + 1)];
    return dissolveSingleMemberGroups(result);
  }

  const sameGroupAsTarget = draggedOriginalSupersetId != null && draggedOriginalSupersetId === target.supersetId;
  const newIdForDragged = sameGroupAsTarget ? draggedOriginalSupersetId : keepTogether && draggedOriginalSupersetId != null ? draggedOriginalSupersetId : null;
  const updatedDragged = dragged.map(i => ({ ...i, supersetId: newIdForDragged }));

  let groupStart = targetIdx;
  let groupEnd = targetIdx;
  if (target.supersetId) {
    while (groupStart - 1 >= 0 && remaining[groupStart - 1].supersetId === target.supersetId) groupStart--;
    while (groupEnd + 1 < remaining.length && remaining[groupEnd + 1].supersetId === target.supersetId) groupEnd++;
  }

  // Reordering a single member within its own group lands it right next to
  // the specific sibling it was dropped on, not at the whole group's edge.
  const insertAt = sameGroupAsTarget ? (zone === 'before' ? targetIdx : targetIdx + 1) : zone === 'before' ? groupStart : groupEnd + 1;

  const result = [...remaining.slice(0, insertAt), ...updatedDragged, ...remaining.slice(insertAt)];
  return dissolveSingleMemberGroups(result);
}

/** Remove every member of a superset from it (used by an explicit "Ungroup" action). */
export function ungroupAll<T extends SupersetDraggable>(items: T[], supersetId: string): T[] {
  return items.map(i => (i.supersetId === supersetId ? { ...i, supersetId: null } : i));
}
