import { AnyScenario, CallData, CallState, StateAction } from './types';

/**
 * Thrown when a transition can't be applied. `reason` is written for the model:
 * it's returned to the agent as the tool result so it can recover.
 */
export class TransitionError extends Error {
  readonly code: 'invalid_action' | 'condition_failed';
  readonly reason: string;

  constructor(code: TransitionError['code'], reason: string) {
    super(reason);
    this.name = 'TransitionError';
    this.code = code;
    this.reason = reason;
  }
}

/** One applied transition. */
export interface TransitionStep {
  from: string;
  action: string;
  to: string;
  /** True when the state's autoAdvance took this action, not the model. */
  automatic: boolean;
}

export interface TransitionResult {
  callState: CallState;
  steps: TransitionStep[];
}

// Guards against autoAdvance rules that loop.
const MAX_AUTO_STEPS = 10;

export function isTerminal(scenario: AnyScenario, state: string): boolean {
  return Object.keys(scenario.states[state]?.actions ?? {}).length === 0;
}

/** Global actions that apply in `state`: none in terminal states, and none that would loop back to `state`. */
function globalActionsFor(scenario: AnyScenario, state: string): [string, StateAction<string, unknown>][] {
  if (isTerminal(scenario, state)) return [];
  return Object.entries(scenario.globalActions ?? {}).filter(
    (entry): entry is [string, StateAction<string, unknown>] => !!entry[1] && entry[1].nextState !== state
  );
}

/** Looks up an action in the state first, then in the global actions. */
export function getAction(scenario: AnyScenario, state: string, action: string): StateAction<string, unknown> | undefined {
  const own = scenario.states[state]?.actions[action];
  if (own) return own;
  return globalActionsFor(scenario, state).find(([name]) => name === action)?.[1];
}

/** Actions the model may take in `state`: the state's own, then the global ones. */
export function getAvailableActions(scenario: AnyScenario, state: string): string[] {
  const own = Object.keys(scenario.states[state]?.actions ?? {});
  const global = globalActionsFor(scenario, state).map(([name]) => name);
  return [...own, ...global.filter((name) => !own.includes(name))];
}

/** Every action name the scenario defines, for the tool's enum. */
export function getAllActions(scenario: AnyScenario): string[] {
  const names = new Set<string>();
  for (const definition of Object.values(scenario.states)) {
    Object.keys(definition.actions).forEach((name) => names.add(name));
  }
  Object.keys(scenario.globalActions ?? {}).forEach((name) => names.add(name));
  return [...names];
}

export function initializeStateMachine(scenario: AnyScenario): CallState {
  return {
    currentState: scenario.initialState,
    previousState: null,
    callData: { stateHistory: [] },
  };
}

/** Adds the facts that came with an action (e.g. the agent's additionalData) to call data. */
export type WithFacts = (callData: CallData) => CallData;
const noFacts: WithFacts = (callData) => callData;

function applyStep(scenario: AnyScenario, callState: CallState, action: string, withFacts: WithFacts = noFacts): CallState {
  const { currentState } = callState;
  const callData = withFacts(callState.callData);
  const definition = getAction(scenario, currentState, action);

  if (!definition) {
    throw new TransitionError(
      'invalid_action',
      scenario.prompts.feedback.invalidAction({ action, state: currentState, valid: getAvailableActions(scenario, currentState) })
    );
  }

  if (definition.condition) {
    const verdict = definition.condition(callData, scenario.context);
    if (verdict !== true) {
      throw new TransitionError(
        'condition_failed',
        typeof verdict === 'string' ? verdict : scenario.prompts.feedback.conditionNotMet({ action, state: currentState })
      );
    }
  }

  // The action's own changes, then the facts that came with it again: an action that resets data (e.g. new_issue
  // clears the last issue) mustn't erase what the agent just said about the new one.
  const updated: CallData = definition.updateData
    ? withFacts({ ...callData, ...definition.updateData(callData, scenario.context) })
    : { ...callData };
  // The next state's enter hook (e.g. a lookup the server always does there).
  const entered = scenario.states[definition.nextState]?.enter?.(updated, scenario.context) ?? {};

  return {
    previousState: currentState,
    currentState: definition.nextState,
    callData: { ...updated, ...entered, stateHistory: [...(updated.stateHistory ?? []), currentState] },
  };
}

/**
 * Applies `action` (with the facts that came with it), then follows any autoAdvance rules of the states it lands
 * in. One caller turn that answers several questions advances several states.
 */
export function transition(scenario: AnyScenario, callState: CallState, action: string, withFacts?: WithFacts): TransitionResult {
  const current = applyStep(scenario, callState, action, withFacts);
  const first: TransitionStep = { from: callState.currentState, action, to: current.currentState, automatic: false };
  const settled = settle(scenario, current);
  return { callState: settled.callState, steps: [first, ...settled.steps] };
}

/**
 * Follows the current state's autoAdvance rules without taking an action first.
 * Run it after a tool changes call data (e.g. a lookup found the account), so
 * the call moves on as soon as the data allows.
 */
export function settle(scenario: AnyScenario, callState: CallState): TransitionResult {
  let current = callState;
  const steps: TransitionStep[] = [];
  for (let i = 0; i < MAX_AUTO_STEPS; i++) {
    const next = scenario.states[current.currentState]?.autoAdvance?.(current.callData, scenario.context);
    if (!next) break;
    let advanced: CallState;
    try {
      advanced = applyStep(scenario, current, next);
    } catch (error) {
      // An autoAdvance that names a blocked action just leaves the call in this state.
      if (error instanceof TransitionError) break;
      throw error;
    }
    steps.push({ from: current.currentState, action: next, to: advanced.currentState, automatic: true });
    current = advanced;
  }
  return { callState: current, steps };
}
