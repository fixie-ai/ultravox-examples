import { AnyScenario, CallData, CallState } from './types';
import { renderStateInstruction } from './prompt';
import { getAvailableActions, transition, TransitionError, TransitionStep } from './stateMachine';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Merges the model's `additionalData` into call data. Only the scenario's
 * `modelWritableKeys` are kept, so the model can't overwrite engine-owned
 * fields like `stateHistory`. Object values merge into the existing object.
 */
export function mergeModelData(callData: CallData, additionalData: unknown, allowedKeys: readonly string[]): CallData {
  if (!isPlainObject(additionalData)) return callData;
  const allowed = Object.entries(additionalData).filter(
    ([key, value]) => allowedKeys.includes(key) && value !== undefined && value !== null && value !== ''
  );
  return mergeOverrides(callData, Object.fromEntries(allowed));
}

/**
 * Applies overrides (e.g. from the decision model) on top of call data. Like the model's data, object values
 * merge into the existing object, so extracted fields add to the details the agent already passed.
 */
export function mergeOverrides(callData: CallData, overrides: Partial<CallData> | undefined): CallData {
  if (!overrides) return callData;
  const merged: CallData = { ...callData };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key];
    merged[key] = isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value;
  }
  return merged;
}

/** Turns the steps of a multi-step transition into a short note for the model, if any state was skipped. */
export function describeSteps(scenario: AnyScenario, steps: TransitionStep[]): string | undefined {
  const skipped = steps.filter((step) => step.automatic);
  if (skipped.length === 0) return undefined;
  return scenario.prompts.feedback.skipped({ states: skipped.map((step) => step.from) });
}

export interface UpdateStateOutcome {
  /** Whether the transition was applied. */
  accepted: boolean;
  /** Text returned to the model as the tool result. */
  result: string;
  /**
   * The call state to store. When the action is rejected this is the old state
   * plus any allowed data the model sent, so facts the caller gave aren't lost.
   */
  callState: CallState;
  steps: TransitionStep[];
  /** Why the action was rejected, for a note in the next instruction. */
  reason?: string;
}

/**
 * Handles an `updateState` tool call: merges allowed data, applies the
 * transition (plus any automatic skips), and returns the next state's
 * instruction. It calls nothing external, so it can be unit tested without a live session.
 */
export function handleUpdateState(
  scenario: AnyScenario,
  params: { action?: unknown; additionalData?: unknown },
  callState: CallState,
  options: {
    /** Call data that wins over the model's additionalData (e.g. from the decision model). */
    overrides?: Partial<CallData>;
    /** Extra note for the next instruction. */
    note?: string;
  } = {}
): UpdateStateOutcome {
  if (!params.action || typeof params.action !== 'string') {
    return { accepted: false, result: scenario.prompts.feedback.actionRequired, callState, steps: [] };
  }

  const withFacts = (callData: CallData) =>
    mergeOverrides(mergeModelData(callData, params.additionalData, scenario.modelWritableKeys), options.overrides);
  const withData: CallState = { ...callState, callData: withFacts(callState.callData) };

  try {
    const { callState: next, steps } = transition(scenario, callState, params.action, withFacts);
    return {
      accepted: true,
      result: renderStateInstruction(scenario, next, {
        afterToolCall: true,
        note: [describeSteps(scenario, steps), options.note].filter(Boolean).join(' ') || undefined,
      }),
      callState: next,
      steps,
    };
  } catch (error) {
    if (error instanceof TransitionError) {
      return { accepted: false, result: scenario.prompts.feedback.rejected({ reason: error.reason }), reason: error.reason, callState: withData, steps: [] };
    }
    // A scenario hook threw (e.g. a backend call in `enter`). Log it; the agent only needs to know it didn't work.
    console.error('Error updating state:', error);
    const valid = getAvailableActions(scenario, callState.currentState);
    return {
      accepted: false,
      result: scenario.prompts.feedback.updateFailed({ state: callState.currentState, valid }),
      callState: withData,
      steps: [],
    };
  }
}
