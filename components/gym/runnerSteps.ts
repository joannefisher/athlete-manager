// components/gym/runnerSteps.ts
// Turns a session's flat, sortOrder-ordered item list into the ordered
// sequence of screens the Player runner shows one at a time. Built on
// groupBySuperset (supersetDnd.ts) so this uses exactly the same notion of
// "which items are in a superset together" as the staff editors do.
//
// 2026-09-04: one screen per ITEM (or per superset GROUP), not one screen
// per SET — Joanne asked for all of an exercise's/conditioning item's sets
// to be visible and editable on a single page instead of paging through
// them set-by-set. A superset's members are shown together on their one
// shared screen too (they're already performed as one physical block), each
// listing its own full set range — a member simply lists fewer/more set
// rows than the others when prescribed counts differ; there's no
// interleaving/round-robin left to compute now that stepping is no longer
// set-by-set. 'running' gets a single set-row (set 1 — no real per-set
// concept in the data model). 'timer'/'note'/'section' get no set rows at
// all (RunnerStepMember.setNumbers === []) — nothing to record, rendered as
// a single display-only control instead of a per-set table.

import type { GymSessionItem, RunnerStep, RunnerStepMember } from './types';
import { groupBySuperset, labelSupersetGroups } from './supersetDnd';

/** Item types that are prescribed a fixed number of sets and get one editable row per set. */
function isSetBearing(itemType: GymSessionItem['itemType']): boolean {
  return itemType === 'exercise' || itemType === 'conditioning';
}

/** item.sets is nullable in the data model — defensively treat missing/invalid as a single set rather than producing zero rows for an item. */
function effectiveSetCount(item: GymSessionItem): number {
  return item.sets && item.sets > 0 ? item.sets : 1;
}

/** [1..N] for a set-bearing item; [1] for running (one editable cell, no real per-set concept); [] for timer/note/section (nothing to record). */
function setNumbersFor(item: GymSessionItem): number[] {
  if (isSetBearing(item.itemType)) {
    return Array.from({ length: effectiveSetCount(item) }, (_, i) => i + 1);
  }
  if (item.itemType === 'running') return [1];
  return [];
}

function toMember(item: GymSessionItem): RunnerStepMember {
  return { item, setNumbers: setNumbersFor(item) };
}

/**
 * Build the full ordered step sequence for a session's items. Pure function
 * — no I/O, no randomness — so it's cheap to re-derive on every render and
 * easy to hand-trace/unit-test.
 */
export function buildStepSequence(items: GymSessionItem[]): RunnerStep[] {
  const steps: RunnerStep[] = [];
  const groups = groupBySuperset(items);
  // Session-wide A/B/C… labels — order of first appearance among `items`,
  // shared with the staff editors and the session-complete summary (see
  // supersetDnd.ts's labelSupersetGroups).
  const labels = labelSupersetGroups(items);

  for (const group of groups) {
    if (!group.supersetId || group.members.length < 2) {
      // Standalone item (including a "superset" of one stray member —
      // shouldn't happen post-dissolveSingleMemberGroups, but treat it the
      // same as standalone rather than rendering a pointless 1-member badge).
      for (const item of group.members) {
        steps.push({ key: item.id, members: [toMember(item)], superset: null });
      }
      continue;
    }

    // Real superset (2+ members): one shared screen, every member's full
    // set range shown together — no interleaving to compute any more, each
    // member just lists its own prescribed sets independently.
    const supersetId = group.supersetId;
    const label = labels.get(supersetId)!; // always set — labelSupersetGroups uses the identical "2+ members" definition of a real superset
    steps.push({
      key: supersetId,
      members: group.members.map(toMember),
      superset: { supersetId, label },
    });
  }

  return steps;
}

/** Locate the resume step for a saved currentItemId pointer — null if not found (e.g. the item was deleted since pausing), signalling "restart from step 1." No longer matches on a set number: a step now shows every set for its item(s) at once, so which set the player was on when they paused doesn't change which step to land on. */
export function findResumeStepIndex(steps: RunnerStep[], currentItemId: string | null): number | null {
  if (!currentItemId) return null;
  const idx = steps.findIndex(s => s.members.some(m => m.item.id === currentItemId));
  return idx === -1 ? null : idx;
}
