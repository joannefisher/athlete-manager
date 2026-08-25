// components/gym/GymUndoContext.tsx
// Single-level "undo the last action" for the Gym module. Deliberately not a
// full history stack — pushUndo() replaces whatever was pending, matching
// "undoes the last action" literally. Mounted once in Gym.tsx around the
// staff UI; each mutating action in SessionEditor/StaffDailyView/
// CopySessionModal/GroupSessionEditor captures what it needs to reverse
// itself (the old value, or the ids it just created) and calls pushUndo
// right after its own save succeeds.

import React, { createContext, useCallback, useContext, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';

export interface GymUndoAction {
  label: string;
  run: () => Promise<void>;
}

interface GymUndoContextValue {
  pending: GymUndoAction | null;
  pushUndo: (action: GymUndoAction) => void;
  undoLast: () => Promise<void>;
  undoing: boolean;
}

const GymUndoContext = createContext<GymUndoContextValue | null>(null);

export const GymUndoProvider = ({ children }: { children: React.ReactNode }) => {
  const [pending, setPending] = useState<GymUndoAction | null>(null);
  const [undoing, setUndoing] = useState(false);

  const pushUndo = useCallback((action: GymUndoAction) => {
    setPending(action);
  }, []);

  const undoLast = useCallback(async () => {
    setPending(current => {
      if (!current) return current;
      setUndoing(true);
      current
        .run()
        .catch(err => {
          console.error('[GymUndo] undo failed', err);
          window.alert('Could not undo that — please check the session and correct it manually if needed.');
        })
        .finally(() => setUndoing(false));
      return null;
    });
  }, []);

  return <GymUndoContext.Provider value={{ pending, pushUndo, undoLast, undoing }}>{children}</GymUndoContext.Provider>;
};

/**
 * Safe to call even outside a GymUndoProvider (e.g. Player views) — returns
 * an inert fallback so callers never need to guard for a missing provider.
 */
export const useGymUndo = (): GymUndoContextValue => {
  const ctx = useContext(GymUndoContext);
  if (!ctx) {
    return { pending: null, pushUndo: () => {}, undoLast: async () => {}, undoing: false };
  }
  return ctx;
};

/** Always-visible Undo control — greyed out with nothing to do when the stack is empty. */
export const GymUndoButton = ({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' | 'canvas' }) => {
  const { pending, undoLast, undoing } = useGymUndo();
  const disabled = !pending || undoing;
  const label = pending ? `Undo: ${pending.label}` : 'Nothing to undo';

  if (variant === 'mobile') {
    return (
      <button
        onClick={undoLast}
        disabled={disabled}
        title={label}
        className={`p-1.5 rounded-lg flex items-center justify-center flex-shrink-0 ${disabled ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
      </button>
    );
  }

  // Lives on the main content header (not tucked into the sidebar) — a
  // light, bordered control matching the rest of Gym's toolbar buttons.
  if (variant === 'canvas') {
    return (
      <button
        onClick={undoLast}
        disabled={disabled}
        title={label}
        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-[11.5px] font-medium max-w-[220px] transition-colors ${
          disabled ? 'border-slate-200 text-slate-300 cursor-default' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
        }`}
      >
        {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />}
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={undoLast}
      disabled={disabled}
      title={label}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded transition-colors ${
        disabled ? 'text-white/25 cursor-default' : 'text-white/70 hover:text-white hover:bg-white/[0.08]'
      }`}
    >
      {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
};
