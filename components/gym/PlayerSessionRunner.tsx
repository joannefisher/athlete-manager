// components/gym/PlayerSessionRunner.tsx
// The step-by-step runner: loads a session (with its items + any results
// already recorded), builds the step sequence (runnerSteps.ts), and walks
// the player through it one screen at a time. Next/Back on every step type
// except 'timer' (Skip only — see PlayerStepTimer). Editable steps
// (exercise/conditioning/running) save a gym_session_item_results row via
// saveSetResult every time the player moves off them (Next, Back, or
// Pause) — not just at the very end — so partial progress is never lost if
// they close the tab mid-session.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, SkipForward } from 'lucide-react';
import { fetchSessionWithResults, pauseSession, completeSession, saveSetResult } from './gymApi';
import { buildStepSequence, findResumeStepIndex } from './runnerSteps';
import type { GymSession, GymSessionItemResult, RunnerStep } from './types';
import { PlayerStepExercise } from './PlayerStepExercise';
import { PlayerStepConditioning } from './PlayerStepConditioning';
import { PlayerStepRunning } from './PlayerStepRunning';
import { PlayerStepTimer } from './PlayerStepTimer';
import { PlayerStepNote } from './PlayerStepNote';
import { PlayerStepSection } from './PlayerStepSection';
import { PlayerSessionSummary } from './PlayerSessionSummary';

/** Local editable-field state for the step currently on screen. Reset whenever the step changes (see the effect below). */
interface StepInput {
  reps: number | null;
  loadKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

const emptyInput: StepInput = { reps: null, loadKg: null, durationSeconds: null, distanceMeters: null };

function existingResultFor(results: GymSessionItemResult[], step: RunnerStep): GymSessionItemResult | undefined {
  // Running has no real per-set concept — always stored/looked-up at set_number 1 regardless of the step's own (null) setNumber.
  const setNumber = step.item.itemType === 'running' ? 1 : step.setNumber ?? 1;
  return results.find(r => r.sessionItemId === step.item.id && r.setNumber === setNumber);
}

function inputFromResult(r: GymSessionItemResult | undefined, step: RunnerStep): StepInput {
  if (r) {
    return { reps: r.actualReps, loadKg: r.actualLoadKg, durationSeconds: r.actualDurationSeconds, distanceMeters: r.actualDistanceMeters };
  }
  // No recorded result yet — default to the prescribed values so the player
  // is editing "what was planned" rather than starting from a blank field.
  const item = step.item;
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
  /** Player paused — return to the Today/calendar view. */
  onPaused: () => void;
  /** Player finished the last step — return to the Today/calendar view. */
  onCompleted: () => void;
}) {
  const [session, setSession] = useState<GymSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState<StepInput>(emptyInput);
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
        const resumeIdx = findResumeStepIndex(built, s.currentItemId, s.currentSetNumber);
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

  // Re-seed the editable fields whenever the step changes — from any
  // already-recorded result for this exact (item, set), else the prescribed
  // defaults. Re-running this only on stepIndex/session change (not on every
  // keystroke) is what lets the player type freely without being reset.
  useEffect(() => {
    if (!step || !session) return;
    setInput(inputFromResult(existingResultFor(session.results || [], step), step));
  }, [stepIndex, session?.id]);

  const isEditable = step && (step.item.itemType === 'exercise' || step.item.itemType === 'conditioning' || step.item.itemType === 'running');

  /** Persist the current step's input (if it's an editable type) before navigating away from it. No-op for display-only/timer steps. */
  const commitCurrentStep = useCallback(async () => {
    if (!step || !isEditable) return;
    const setNumber = step.item.itemType === 'running' ? 1 : step.setNumber ?? 1;
    try {
      const saved = await saveSetResult(
        clubId,
        sessionId,
        step.item.id,
        setNumber,
        {
          actualReps: step.item.itemType !== 'running' ? input.reps : undefined,
          actualLoadKg: step.item.itemType === 'exercise' ? input.loadKg : undefined,
          actualDurationSeconds: step.item.itemType === 'conditioning' ? input.durationSeconds : undefined,
          actualDistanceMeters: step.item.itemType === 'running' ? input.distanceMeters : undefined,
        },
        userId
      );
      // Reflect the save locally so re-visiting this step (Back, or a later resume) shows it without a refetch.
      setSession(prev => {
        if (!prev) return prev;
        const results = (prev.results || []).filter(r => !(r.sessionItemId === saved.sessionItemId && r.setNumber === saved.setNumber));
        return { ...prev, results: [...results, saved] };
      });
    } catch (err) {
      console.error('[PlayerSessionRunner] failed to save set result', err);
      setError('Could not save that result — check your connection and try again.');
      throw err;
    }
  }, [step, isEditable, clubId, sessionId, input, userId]);

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
      const setNumber = step.item.itemType === 'running' ? 1 : step.setNumber;
      await pauseSession(sessionId, step.item.id, setNumber ?? null);
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

  const isTimer = step.item.itemType === 'timer';
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
          <p className="text-[11px] font-semibold text-purple-600 mt-2">
            Superset {step.superset.label} · exercise {step.superset.position} of {step.superset.size}
          </p>
        )}
        {step.setNumber != null && (
          <p className="text-[11px] text-slate-400 mt-1">Set {step.setNumber}{step.item.sets ? ` of ${step.item.sets}` : ''}</p>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        {step.item.itemType === 'exercise' && (
          <PlayerStepExercise
            step={step}
            reps={input.reps}
            loadKg={input.loadKg}
            onRepsChange={v => setInput(prev => ({ ...prev, reps: v }))}
            onLoadKgChange={v => setInput(prev => ({ ...prev, loadKg: v }))}
          />
        )}
        {step.item.itemType === 'conditioning' && (
          <PlayerStepConditioning
            step={step}
            reps={input.reps}
            durationSeconds={input.durationSeconds}
            onRepsChange={v => setInput(prev => ({ ...prev, reps: v }))}
            onDurationSecondsChange={v => setInput(prev => ({ ...prev, durationSeconds: v }))}
          />
        )}
        {step.item.itemType === 'running' && (
          <PlayerStepRunning
            step={step}
            distanceMeters={input.distanceMeters}
            onDistanceMetersChange={v => setInput(prev => ({ ...prev, distanceMeters: v }))}
          />
        )}
        {step.item.itemType === 'timer' && <PlayerStepTimer key={step.key} step={step} />}
        {step.item.itemType === 'note' && <PlayerStepNote step={step} />}
        {step.item.itemType === 'section' && <PlayerStepSection step={step} />}

        {error && <p className="text-[12px] text-red-600 mt-4 text-center">{error}</p>}
      </div>

      {/* Navigation */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-2">
        {isTimer ? (
          <button
            onClick={skipTimer}
            disabled={busy}
            className="flex-1 h-12 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white text-[14px] font-semibold disabled:opacity-50"
          >
            {isLastStep ? 'Finish' : 'Skip'} <SkipForward className="w-4 h-4" />
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
