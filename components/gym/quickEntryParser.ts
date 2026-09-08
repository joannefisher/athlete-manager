// components/gym/quickEntryParser.ts
// Shorthand-line parser for QuickSessionPlanner's "Quick text" entry mode.
// One line of typed text -> one session item, so the whole add step is
// "type, hit Enter" with no taps at all. No prefix = exercise (the common
// case); every other type needs an explicit short prefix so a single flat
// text box can express all six item types unambiguously. Exercise/
// conditioning/running names are NOT resolved to bank ids here — this
// module has no knowledge of the bank lists, that's done by the caller via
// search + the live suggestion dropdown (see QuickSessionPlanner.tsx). This
// keeps the parser pure and independently testable.

import type { GymSessionItemType } from './types';

const PREFIXES: { prefixes: string[]; type: GymSessionItemType }[] = [
  { prefixes: ['#'], type: 'section' },
  { prefixes: ['section:', 'sec:'], type: 'section' },
  { prefixes: ['note:', 'n:'], type: 'note' },
  { prefixes: ['timer:', 't:'], type: 'timer' },
  { prefixes: ['run:', 'r:'], type: 'running' },
  { prefixes: ['cond:', 'c:'], type: 'conditioning' },
  { prefixes: ['ex:', 'e:'], type: 'exercise' },
];

/** Strips a leading type prefix (if any) and returns which item type it means. No prefix -> 'exercise'. */
export function detectLineType(raw: string): { type: GymSessionItemType; rest: string } {
  const trimmed = raw.trimStart();
  const lower = trimmed.toLowerCase();
  for (const { prefixes, type } of PREFIXES) {
    for (const p of prefixes) {
      if (lower.startsWith(p)) {
        return { type, rest: trimmed.slice(p.length).trim() };
      }
    }
  }
  return { type: 'exercise', rest: trimmed.trim() };
}

/**
 * Splits e.g. "Back Squat 3x8 80kg" -> name "Back Squat", sets 3, reps 8,
 * loadKg 80. The "NxR" pair and the trailing load are both optional, but
 * load can only appear once sets/reps are present (matches how anyone would
 * actually say it out loud: sets x reps, then weight).
 */
export function parseSetsRepsLoad(text: string): { name: string; sets: number | null; reps: number | null; loadKg: number | null } {
  const m = text.match(/^(.*?)\s+(\d+)\s*x\s*(\d+)(?:\s*(?:x|@|\/|\*)?\s*(\d+(?:\.\d+)?)\s*(?:kg)?)?\s*$/i);
  if (!m) return { name: text.trim(), sets: null, reps: null, loadKg: null };
  return { name: m[1].trim(), sets: Number(m[2]), reps: Number(m[3]), loadKg: m[4] != null ? Number(m[4]) : null };
}

/** Same as parseSetsRepsLoad but no load — conditioning has no Load(kg) field. */
export function parseSetsReps(text: string): { name: string; sets: number | null; reps: number | null } {
  const m = text.match(/^(.*?)\s+(\d+)\s*x\s*(\d+)\s*$/i);
  if (!m) return { name: text.trim(), sets: null, reps: null };
  return { name: m[1].trim(), sets: Number(m[2]), reps: Number(m[3]) };
}

/**
 * Splits e.g. "Rest between rounds 1:30" / "...90s" / "...2m" / "...90" ->
 * label + total duration in seconds. Tries the most specific pattern first;
 * a bare trailing number with no unit is assumed to be seconds (the common
 * case for short rest timers).
 */
export function parseTimerShorthand(text: string): { label: string; durationSeconds: number | null } {
  let m = text.match(/^(.*?)\s+(\d{1,2}):(\d{2})\s*$/);
  if (m) return { label: m[1].trim(), durationSeconds: Number(m[2]) * 60 + Number(m[3]) };

  m = text.match(/^(.*?)\s+(\d+)\s*m(?:in)?\s*(\d+)\s*s(?:ec)?\s*$/i);
  if (m) return { label: m[1].trim(), durationSeconds: Number(m[2]) * 60 + Number(m[3]) };

  m = text.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*m(?:in)?\s*$/i);
  if (m) return { label: m[1].trim(), durationSeconds: Math.round(Number(m[2]) * 60) };

  m = text.match(/^(.*?)\s+(\d+)\s*s(?:ec)?\s*$/i);
  if (m) return { label: m[1].trim(), durationSeconds: Number(m[2]) };

  m = text.match(/^(.*?)\s+(\d+)\s*$/);
  if (m) return { label: m[1].trim(), durationSeconds: Number(m[2]) };

  return { label: text.trim(), durationSeconds: null };
}
