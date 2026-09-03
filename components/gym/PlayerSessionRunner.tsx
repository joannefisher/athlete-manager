// components/gym/PlayerSessionRunner.tsx
// The step-by-step runner: loads a session (with its items + any results
// already recorded), builds the step sequence (runnerSteps.ts), and walks
// the player through it one screen at a time. 2026-09-04: a screen now shows
// every prescribed set for its item(s) at once (previously one set per
// screen) — see runnerSteps.ts's header comment. Next/Back on every step
// type except 'timer' (Skip only, and now also auto-advances when the
// countdown hits zero — see PlayerStepTimer) and 'section' (a dedicated
// Continue/Exit-session choice, since Joanne asked for a section boundary to
// double as a natural checkpoint). Editable steps (exercise/conditioning/
// running) save every visible set's gym_session_item_results row every time
// the player moves off the screen (Next, Back, or Pause) — not just at the
// very end — so partial progress is never lost if they close the tab
// mid-session.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, SkipForward } from 'lucide-react';
import { fetchSessionWithResults, pauseSession, completeSession, saveSetResult } from './gymApi';
import { buildStepSequence, findResumeStepIndex } from './runnerSteps';
import type { GymSession, GymSessionItem, GymSessionItemResult, RunnerStep } from './types';
import { PlayerStepExercise } from './PlayerStepExercise';
import { PlayerStepConditioning } from './PlayerStepConditioning';
import { PlayerStepRunning } from './PlayerStepRunning';
import { PlayerStepTimer } from './PlayerStepTimer';
import { PlayerStepNote } from './PlayerStepNote';
import { PlayerStepSection } from './PlayerStepSection';
import { PlayerSessionSummary } from './PlayerSessionSummary';

/** Local editable-field state for one (item, set) cell currently on screen. Reset/reseeded whenever the step changes (see the effect below). */
interface StepInput {
  reps: number | null;
  loadKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

const emptyInput: StepInput = { reps: null, loadKg: null, durationSeconds: null, distanceMeters: null };

function cellKey(itemId: string, setNumber: number): string {
  return `${itemId}:${setNumber}`;
}

function inputFromResult(r: GymSessionItemResult | undefined, item: GymSessionItem): StepInput {
  if (r) {
    return { reps: r.actualReps, loadKg: r.actualLoadKg, durationSeconds: r.actualDurationSeconds, distanceMeters: r.actualDistanceMeters };
  }
  // No recorded result yet — default to the prescribed values so the player
  // is editing "what was planned" rather than starting from a blank field.
  return {
    reps: item.reps,
    loadKg: item.loadKg,
    durationSeconds: null,
    distanceMeters: null,
  };
}

export function PlayerSessionRunner({
  sessionId,
  athleteId,
  clubId,
  userId,
  onPaused,
  onCompleted,
}: {
  sessionId: string;
  athleteId: string;
  clubId: string;
  userId: string;
  /** Player paused (or exited from a section checkpoint) — return to the Today/calendar view. */
  onPaused: () => void;
  /** Player finished the last step — return to the Today/calendar view. */
  onCompleted: () => void;
}) {
  const [session, setSession] = useState<GymSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  // Keyed by cellKey(itemId, setNumber) — every editable set-row currently
  // on screen lives in here at once, since a screen can now show many rows
  // (all of one exercise's sets, or a whole superset's worth).
  const [inputs, setInputs] = useState<Record<string, StepInput>>({});
  const [busy, setBusy] = useState(false); // Next/Back/Skip/Pause in flight — blocks double-taps
  const [error, setError] = useState<string | null>(null);
  // Set once the last step is committed and the session is marked complete
  // server-side — swaps the whole screen for PlayerSessionSummary instead of
  // calling onCompleted() immediately, so the player sees a recap first.
  const [showSummary, setShowSummary] = useState(false);

  const steps = useMemo(() => (session?.items ? buildStepSequence(session.items) : []), [session?.items]);
  const step = steps[stepIndex] as RunnerStep | undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchSessionWithResults(sessionId);
      setSession(s);
      if (s) {
        const built = s.items ? buildStepSequence(s.items) : [];
        const resumeIdx = findResumeStepIndex(built, s.currentItemId);
        setStepIndex(resumeIdx ?? 0);
      }
    } catch (err) {
      console.error('[PlayerSessionRunner] failed to load session', err);
      setError('Could not load this session.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // Re-seed every editable cell on the new step — from any already-recorded
  // result for that exact (item, set), else the prescribed defaults. By the
  // time this fires, the previous step's edits are already persisted (goNext/
  // goBack await commitCurrentStep first), so it's safe to always reseed
  // rather than trying to preserve unsaved in-memory state across a step
  // change.
  useEffect(() => {
    if (!step || !session) return;
    setInputs(prev => {
      const next = { ...prev };
      for (const member of step.members) {
        for (const setNumber of member.setNumbers) {
          const key = cellKey(member.item.id, setNumber);
          const existing = (session.results || []).find(r => r.sessionItemId === member.item.id && r.setNumber === setNumber);
          next[key] = inputFromResult(existing, member.item);
        }
      }
      return next;
    });
  }, [stepIndex, session?.id]);

  const setCell = (itemId: string, setNumber: number, patch: Partial<StepInput>) => {
    setInputs(prev => ({ ...prev, [cellKey(itemId, setNumber)]: { ...(prev[cellKey(itemId, setNumber)] ?? emptyInput), ...patch } }));
  };

  /** Persist every editable cell on the current step before navigating away from it. No-op for a step with nothing editable (timer/note/section). */
  const commitCurrentStep = useCallback(async () => {
    if (!step) return;
    const cells: { item: GymSessionItem; setNumber: number }[] = [];
    for (const member of step.members) {
      for (const setNumber of member.setNumbers) {
        cells.push({ item: member.item, setNumber });
      }
    }
    if (cells.length === 0) return;
    try {
      const saved = await Promise.all(
        cells.map(({ item, setNumber }) => {
          const val = inputs[cellKey(item.id, setNumber)] ?? emptyInput;
          return saveSetResult(
            clubId,
            sessionId,
            item.id,
            setNumber,
            {
              actualReps: item.itemType !== 'running' ? val.reps : undefined,
              actualLoadKg: item.itemType === 'exercise' ? val.loadKg : undefined,
              actualDurationSeconds: item.itemType === 'conditioning' ? val.durationSeconds : undefined,
              actualDistanceMeters: item.itemType === 'running' ? val.distanceMeters : undefined,
            },
            userId
          );
        })
      );
      // Reflect the saves locally so re-visiting this step (Back, or a later resume) shows them without a refetch.
      setSession(prev => {
        if (!prev) return prev;
        const keep = (prev.results || []).filter(r => !saved.some(s => s.sessionItemId === r.sessionItemId && s.setNumber === r.setNumber));
        return { ...prev, results: [...keep, ...saved] };
      });
    } catch (err) {
      console.error('[PlayerSessionRunner] failed to save set results', err);
      setError('Could not save your results — check your connection and try again.');
      throw err;
    }
  }, [step, inputs, clubId, sessionId, userId]);

  const goNext = async () => {
    if (!step || busy) return;
    setBusy(true);
    setError(null);
    try {
      await commitCurrentStep();
      if (stepIndex >= steps.length - 1) {
        await completeSession(sessionId);
        // Refetch so the summary screen has completedAt/startedAt and every
        // saved result, not just what happens to already be in local state.
        await load();
        setShowSummary(true);
      } else {
        setStepIndex(i => i + 1);
      }
    } catch {
      // error already surfaced by commitCurrentStep
    } finally {
      setBusy(false);
    }
  };

  const goBack = async () => {
    if (!step || busy || stepIndex === 0) return;
    setBusy(true);
    setError(null);
    try {
      await commitCurrentStep();
      setStepIndex(i => Math.max(0, i - 1));
    } catch {
      // error already surfaced by commitCurrentStep
    } finally {
      setBusy(false);
    }
  };

  const skipTimer = () => {
    if (busy) return;
    if (stepIndex >= steps.length - 1) {
      setBusy(true);
      completeSession(sessionId)
        .then(() => load())
        .then(() => setShowSummary(true))
        .catch(err => {
          console.error('[PlayerSessionRunner] failed to complete session', err);
          setError('Could not finish the session — check your connection and try again.');
        })
        .finally(() => setBusy(false));
    } else {
      setStepIndex(i => i + 1);
    }
  };

  const handlePause = async () => {
    if (!step || busy) return;
    setBusy(true);
    setError(null);
    try {
      await commitCurrentStep();
      // No single "current set" any more — a step shows every set at once —
      // so the resume pointer is just the step's (first) item; the runner
      // lands back on that whole step, not a specific row within it.
      const firstItemId = step.members[0]?.item.id ?? null;
      await pauseSession(sessionId, firstItemId, null);
      onPaused();
    } catch (err) {
      console.error('[PlayerSessionRunner] failed to pause session', err);
      setError('Could not pause — check your connection and try again.');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (showSummary && session) {
    return <PlayerSessionSummary session={session} onDone={onCompleted} />;
  }

  if (!session || steps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center border border-slate-200">
          <p className="text-slate-700 font-medium mb-2">Nothing to run</p>
          <p className="text-slate-400 text-sm">This session has no exercises in it yet.</p>
          <button onClick={onPaused} className="mt-4 text-[13px] text-blue-600 font-medium">Back to calendar</button>
        </div>
      </div>
    );
  }

  if (!step) return null; // stepIndex out of range — shouldn't happen, defensive

  const singleItemType = step.members.length === 1 ? step.members[0].item.itemType : null;
  const isTimer = singleItemType === 'timer';
  const isSection = singleItemType === 'section';
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50">
      {/* Progress + Pause */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-slate-400">Step {stepIndex + 1} of {steps.length}</span>
          <button onClick={handlePause} disabled={busy} className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40">
            <Pause className="w-3.5 h-3.5" /> Pause
          </button>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
        {step.superset && (
          <p className="text-[11px] font-semibold text-purple-600 mt-2">Superset {step.superset.label}</p>
        )}
      </div>

      {/* Step content — one block per member; a superset step shows every member's block, each with its own full set of rows. */}
      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-8">
        {step.members.map((member, idx) => {
          const item = member.item;
          return (
            <div key={item.id} className={idx > 0 ? 'pt-6 border-t border-slate-100' : ''}>
              {item.itemType === 'exercise' && (
                <PlayerStepExercise
                  item={item}
                  setNumbers={member.setNumbers}
                  getValue={setNumber => {
                    const v = inputs[cellKey(item.id, setNumber)] ?? emptyInput;
                    return { reps: v.reps, loadKg: v.loadKg };
                  }}
                  onChange={(setNumber, field, value) => setCell(item.id, setNumber, { [field]: value })}
                />
              )}
              {item.itemType === 'conditioning' && (
                <PlayerStepConditioning
                  item={item}
                  setNumbers={member.setNumbers}
                  getValue={setNumber => {
                    const v = inputs[cellKey(item.id, setNumber)] ?? emptyInput;
                    return { reps: v.reps, durationSeconds: v.durationSeconds };
                  }}
                  onChange={(setNumber, field, value) => setCell(item.id, setNumber, { [field]: value })}
                />
              )}
              {item.itemType === 'running' && (
                <PlayerStepRunning
                  item={item}
                  distanceMeters={(inputs[cellKey(item.id, 1)] ?? emptyInput).distanceMeters}
                  onDistanceMetersChange={v => setCell(item.id, 1, { distanceMeters: v })}
                />
              )}
              {item.itemType === 'timer' && <PlayerStepTimer key={step.key} item={item} stepKey={step.key} onDone={skipTimer} />}
              {item.itemType === 'note' && <PlayerStepNote item={item} />}
              {item.itemType === 'section' && <PlayerStepSection item={item} />}
            </div>
          );
        })}

        {error && <p className="text-[12px] text-red-600 mt-4 text-center">{error}</p>}
      </div>

      {/* Navigation */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
        {isTimer ? (
          <button
            onClick={skipTimer}
            disabled={busy}
            className="w-full h-12 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white text-[14px] font-semibold disabled:opacity-50"
          >
            {isLastStep ? 'Finish' : 'Skip'} <SkipForward className="w-4 h-4" />
          </button>
        ) : isSection ? (
          // A section boundary doubles as a checkpoint — Continue behaves
          // exactly like Next, Exit session exactly like Pause (both reuse
          // the same handlers as everywhere else in this file).
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={goBack}
                disabled={busy || isFirstStep}
                className="h-12 px-4 flex items-center gap-1 rounded-xl border border-slate-200 text-slate-600 text-[14px] font-medium disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={goNext}
                disabled={busy}
                className="flex-1 h-12 flex items-center justify-center gap-1 rounded-xl bg-slate-900 text-white text-[14px] font-semibold disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isLastStep ? 'Finish session' : <>Continue <ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
            <button
              onClick={handlePause}
              disabled={busy}
              className="h-11 w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-slate-500 text-[13px] font-medium disabled:opacity-40"
            >
              <Pause className="w-3.5 h-3.5" /> Exit session
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={goBack}
              disabled={busy || isFirstStep}
              className="h-12 px-4 flex items-center gap-1 rounded-xl border border-slate-200 text-slate-600 text-[14px] font-medium disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={goNext}
              disabled={busy}
              className="flex-1 h-12 flex items-center justify-center gap-1 rounded-xl bg-slate-900 text-white text-[14px] font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isLastStep ? 'Finish session' : <>Next <ChevronRight className="w-4 h-4" /></>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
