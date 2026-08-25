// components/gym/permissions.ts
// Gym-specific permission helper. Kept here (rather than re-exported from
// AthleteManager.tsx) because AthleteManager.tsx is now just the app
// selector/hub — it doesn't own per-app permission logic, each app does.

import type { Role } from '../AthleteManager';

// Admin/Coach can create/edit/delete Gym sessions and items; S&C/Physio get
// view-only. Every Gym write path goes through this one helper — change it
// here if the split should be different.
export const gymCanEdit = (role: Role) => role === 'Admin' || role === 'Coach';
