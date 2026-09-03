// components/gym/runnerSteps.ts
// Turns a session's flat, sortOrder-ordered item list into the ordered
// sequence of screens the Player runner shows one at a time. Built on
// groupBySuperset (supersetDnd.ts) so this uses exactly the same notion of
// "which items are in a superset together" as the staff editors do.
//
// Step-per-set: 'exercise'/'conditioning' items are prescribed a fixed
// number of sets (item.sets) and get one RunnerStep per set — the player
// records a result (see GymSessionItemResult) each time they land on one.
// Everything else (running/timer/note/section) has no real "set" concept
// and is a single step, setNumber null.
//
// Supersets: confirmed with Joanne as INTERLEAVED rounds, not
// sequential-then-next-exercise — A1 set 1, A2 set 1, A1 set 2, A2 set 2,
// ... rather than all of A1's sets before starting A2. Members can have
// different prescribed set counts; a member simply drops out of the
// rotation once its own sets are exhausted while the others continue (no
// padding/repeating a finished member's last set to keep the rounds even —
// Joanne confirmed this explicitly).

import type { GymSessionItem, RunnerStep } from './types';
import { groupBySuperset } from './supersetDnd';

/** Item types that are prescribed a fixed number of sets and get one RunnerStep per set. */
function isSetBearing(itemType: GymSessionItem['itemType']): boolean {
  return itemType === 'exercise' || itemType === 'conditioning';
}

/** item.sets is nullable in the data model — defensively treat missing/invalid as a single set rather than producing zero steps for an item. */
function effectiveSetCount(item: GymSessionItem): number {
  if (!isSetBearing(item.itemType)) return 1;
  return item.sets && item.sets > 0 ? item.sets : 1;
}

function stepKey(item: GymSessionItem, setNumber: number | null): string {
  return `${item.id}:${setNumber ?? ''}`;
}

/**
 * Build the full ordered step sequence for a session's items. Pure function
 * — no I/O, no randomness — so it's cheap to re-derive on every render and
 * easy to hand-trace/unit-test.
 */
export function buildStepSequence(items: GymSessionItem[]): RunnerStep[] {
  const steps: RunnerStep[] = [];
  const groups = groupBySuperset(items);

  for (const group of groups) {
    if (!group.supersetId || group.members.length < 2) {
      // Standalone item (including a "superset" of one stray member —
      // shouldn't happen post-dissolveSingleMemberGroups, but treat it the
      // same as standalone rather than rendering a pointless 1-member badge).
      for (const item of group.members) {
        const total = effectiveSetCount(item);
        if (isSetBearing(item.itemType)) {
          for (let setNumber = 1; setNumber <= total; setNumber++) {
            steps.push({
              key: stepKey(item, setNumber),
              item,
              setNumber,
              isFirstOfItem: setNumber === 1,
              isLastOfItem: setNumber === total,
              superset: null,
            });
          }
        } else {
          steps.push({
            key: stepKey(item, null),
            item,
            setNumber: null,
            isFirstOfItem: true,
            isLastOfItem: true,
            superset: null,
          });
        }
      }
      continue;
    }

    // Real superset (2+ members): interleave round-by-round, dropping a
    // member out once its own set count is exhausted.
    const supersetId = group.supersetId;
    const size = group.members.length;
    const counts = group.members.map(effectiveSetCount);
    const maxRounds = Math.max(...counts);

    for (let round = 1; round <= maxRounds; round++) {
      group.members.forEach((item, idx) => {
        const total = counts[idx];
        if (round > total) return; // this member has dropped out of the rotation
        const setBearing = isSetBearing(item.itemType);
        const setNumber = setBearing ? round : null;
        steps.push({
          key: stepKey(item, setNumber),
          item,
          setNumber,
          isFirstOfItem: round === 1,
          isLastOfItem: round === total,
          superset: { supersetId, position: idx + 1, size },
        });
      });
    }
  }

  return steps;
}

/** Locate the resume step for a saved (currentItemId, currentSetNumber) pointer — null if not found (e.g. the item was deleted since pausing), signalling "restart from step 1." */
export function findResumeStepIndex(
  steps: RunnerStep[],
  currentItemId: string | null,
  currentSetNumber: number | null
): number | null {
  if (!currentItemId) return null;
  const idx = steps.findIndex(
    s => s.item.id === currentItemId && (s.setNumber ?? null) === (currentSetNumber ?? null)
  );
  return idx === -1 ? null : idx;
}
