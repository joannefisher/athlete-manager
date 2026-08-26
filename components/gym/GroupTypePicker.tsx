// components/gym/GroupTypePicker.tsx
// Round 17: the small attribute wizard used everywhere an Exercise Group
// Type needs to be picked or created — the Exercises admin screen's "add
// exercise"/"needs review" flows and the session/group-plan "add new
// exercise" inline flows (SessionEditor.tsx, GroupPlanEditor.tsx) all reuse
// this same component, per Joanne's "collect these attributes from both the
// exercise list UI and the session UI." Two independent choices:
//   - Upper Body (then Push/Pull AND Vertical/Horizontal, both required) or
//     Lower Body (then Anterior/Posterior/Other, one of three)
//   - Unilateral/Bilateral — always shown, applies no matter which body
//     region/sub-attribute was picked
// This never creates a duplicate combination — see gymApi.findOrCreateExerciseGroupType,
// which looks up an existing row for the exact combination before inserting.

import React from 'react';
import type { GymBodyRegion, GymExerciseGroupType, GymLaterality, GymLowerPosition, GymUpperPlane, GymUpperPushPull } from './types';

export interface GroupTypeAttrs {
  bodyRegion: GymBodyRegion | null;
  upperPushPull: GymUpperPushPull | null;
  upperPlane: GymUpperPlane | null;
  lowerPosition: GymLowerPosition | null;
  laterality: GymLaterality | null;
}

export const emptyGroupTypeAttrs: GroupTypeAttrs = {
  bodyRegion: null,
  upperPushPull: null,
  upperPlane: null,
  lowerPosition: null,
  laterality: null,
};

export function isGroupTypeAttrsComplete(a: GroupTypeAttrs): boolean {
  if (!a.laterality) return false;
  if (a.bodyRegion === 'upper') return !!a.upperPushPull && !!a.upperPlane;
  if (a.bodyRegion === 'lower') return !!a.lowerPosition;
  return false;
}

/** e.g. "Lower Body · Anterior · Bilateral" or "Upper Body · Push · Vertical · Unilateral". */
export function groupTypeLabel(t: GroupTypeAttrs | GymExerciseGroupType): string {
  const parts: string[] = [];
  if (t.bodyRegion === 'upper') {
    parts.push('Upper Body');
    if (t.upperPushPull) parts.push(t.upperPushPull === 'push' ? 'Push' : 'Pull');
    if (t.upperPlane) parts.push(t.upperPlane === 'vertical' ? 'Vertical' : 'Horizontal');
  } else if (t.bodyRegion === 'lower') {
    parts.push('Lower Body');
    if (t.lowerPosition) parts.push(t.lowerPosition === 'anterior' ? 'Anterior' : t.lowerPosition === 'posterior' ? 'Posterior' : 'Other');
  }
  if (t.laterality) parts.push(t.laterality === 'unilateral' ? 'Unilateral' : 'Bilateral');
  return parts.length ? parts.join(' · ') : 'Not set';
}

export function groupTypeToAttrs(t: GymExerciseGroupType): GroupTypeAttrs {
  return {
    bodyRegion: t.bodyRegion,
    upperPushPull: t.upperPushPull,
    upperPlane: t.upperPlane,
    lowerPosition: t.lowerPosition,
    laterality: t.laterality,
  };
}

const segBtn = (active: boolean) =>
  `flex-1 h-8 px-2 text-[12px] font-medium rounded border ${
    active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
  }`;

export const GroupTypePicker = ({ value, onChange }: { value: GroupTypeAttrs; onChange: (next: GroupTypeAttrs) => void }) => {
  const setBodyRegion = (bodyRegion: GymBodyRegion) => {
    // Switching body region clears the other region's sub-attribute so a
    // stale pick can't linger and silently fail the shape check.
    onChange({ ...value, bodyRegion, upperPushPull: null, upperPlane: null, lowerPosition: null });
  };

  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Body region</label>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setBodyRegion('upper')} className={segBtn(value.bodyRegion === 'upper')}>Upper Body</button>
          <button type="button" onClick={() => setBodyRegion('lower')} className={segBtn(value.bodyRegion === 'lower')}>Lower Body</button>
        </div>
      </div>

      {value.bodyRegion === 'upper' && (
        <>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Push or Pull</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => onChange({ ...value, upperPushPull: 'push' })} className={segBtn(value.upperPushPull === 'push')}>Push</button>
              <button type="button" onClick={() => onChange({ ...value, upperPushPull: 'pull' })} className={segBtn(value.upperPushPull === 'pull')}>Pull</button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Vertical or Horizontal</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => onChange({ ...value, upperPlane: 'vertical' })} className={segBtn(value.upperPlane === 'vertical')}>Vertical</button>
              <button type="button" onClick={() => onChange({ ...value, upperPlane: 'horizontal' })} className={segBtn(value.upperPlane === 'horizontal')}>Horizontal</button>
            </div>
          </div>
        </>
      )}

      {value.bodyRegion === 'lower' && (
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Anterior, Posterior, or Other</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onChange({ ...value, lowerPosition: 'anterior' })} className={segBtn(value.lowerPosition === 'anterior')}>Anterior</button>
            <button type="button" onClick={() => onChange({ ...value, lowerPosition: 'posterior' })} className={segBtn(value.lowerPosition === 'posterior')}>Posterior</button>
            <button type="button" onClick={() => onChange({ ...value, lowerPosition: 'other' })} className={segBtn(value.lowerPosition === 'other')}>Other</button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Unilateral or Bilateral</label>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onChange({ ...value, laterality: 'unilateral' })} className={segBtn(value.laterality === 'unilateral')}>Unilateral</button>
          <button type="button" onClick={() => onChange({ ...value, laterality: 'bilateral' })} className={segBtn(value.laterality === 'bilateral')}>Bilateral</button>
        </div>
      </div>
    </div>
  );
};
