// components/gym/GymUI2Placeholder.tsx
// Stand-in for the sessions view while "UI 2" is switched on. UI 1 (GymRoot)
// is untouched and remains the default — this only exists so the toggle in
// Gym.tsx has something real to switch to before a UI 2 mockup direction is
// picked and actually built out.

import React from 'react';
import { CalendarDays } from 'lucide-react';

export const GymUI2Placeholder = () => (
  <div className="flex-1 flex items-center justify-center p-4">
    <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center border border-slate-200">
      <CalendarDays className="w-6 h-6 text-slate-300 mx-auto mb-2" />
      <p className="text-slate-700 font-medium mb-2">UI 2 is still being designed</p>
      <p className="text-slate-400 text-sm">
        Switch back to UI 1 to keep working. UI 2 will be built here once a mockup direction is reviewed and approved.
      </p>
    </div>
  </div>
);
