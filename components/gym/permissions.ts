// components/gym/permissions.ts
// Gym-specific permission helper. Kept here (rather than re-exported from
// AthleteManager.tsx) because AthleteManager.tsx is now just the app
// selector/hub — it doesn't own per-app permission logic, each app does.

import type { Role } from '../AthleteManager';

// Admin, S&C, and Physio all get full create/edit/delete rights across Gym
// — sessions, groups, setup (add player, CSV import, the default-exercise
// matrix), and the exercise bank (creating exercises, which can implicitly
// create a new Exercise Group Type — Joanne confirmed S&C/Physio should be
// able to do that too, same as Admin). Every Gym write path goes through
// this one helper — change it here if the split should ever be different.
//
// 2026-09-03: S&C and Physio changed from view-only to full edit parity
// with Admin (previously `role === 'Admin'` only, and before that
// `role === 'Admin' || role === 'Coach'` — Coach still has zero Gym access,
// see AthleteManager.tsx's APPS list). The one deliberate exception to
// "S&C/Physio = full edit access" is NOT expressed here: the exercise
// duplicate-review queue stays Admin-only via its own separate check
// (`role === 'Admin'` in ExerciseBankAdmin.tsx, gating ExerciseReviewPanel)
// rather than through this helper, since that's a narrower carve-out than
// "can this role write to Gym at all."
export const gymCanEdit = (role: Role) => role === 'Admin' || role === 'S&C' || role === 'Physio';
