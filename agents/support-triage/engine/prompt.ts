import { AnyScenario, CallState, GoalInstruction } from './types';
import { getAvailableActions, initializeStateMachine, isTerminal } from './stateMachine';

// ----------------------------------------------------------------------------- //
// Putting the prompts together. The text is the scenario's (agent/prompts.ts);  //
// this adds what's generated from the states: the action lists, and which       //
// actions are valid now.                                                        //
// ----------------------------------------------------------------------------- //

/** The state machine's tool. */
export const MAIN_TOOL = 'updateState';

/** System guidance, never the caller's words. The rules tell the agent so; the engine recognizes it by the tags. */
export function wrapInstruction(text: string): string {
  return `<instruction>\n${text}\n</instruction>`;
}

/** A state's goal, with its values filled in. */
export function stateGoal(scenario: AnyScenario, callState: CallState): GoalInstruction {
  const { currentState, callData, previousState } = callState;
  return scenario.prompts.states[currentState]({ context: scenario.context, callData, previousState });
}

/**
 * The instruction for the call's current state. `afterToolCall` adds the line that keeps the agent from repeating
 * itself; `note` explains what just happened.
 */
export function renderStateInstruction(scenario: AnyScenario, callState: CallState, options: { afterToolCall?: boolean; note?: string } = {}): string {
  const state = callState.currentState;
  return wrapInstruction(
    scenario.prompts.instruction({
      state,
      note: options.note,
      goal: scenario.prompts.goal(stateGoal(scenario, callState)),
      validActions: isTerminal(scenario, state) ? undefined : getAvailableActions(scenario, state),
      afterToolCall: !!options.afterToolCall,
    })
  );
}

const described = (scenario: AnyScenario, actions: string[]) =>
  actions.map((action) => ({ action, description: scenario.prompts.actions[action] }));

/** The system prompt: the scenario's text, with the action lists generated so it can't name one that doesn't exist. */
export function buildSystemPrompt(scenario: AnyScenario): string {
  const states = Object.keys(scenario.states);
  const globalActions = Object.keys(scenario.globalActions ?? {});
  return scenario.prompts.systemPrompt({
    context: scenario.context,
    actionsByState: states
      .filter((state) => !isTerminal(scenario, state))
      .map((state) => ({ state, actions: described(scenario, Object.keys(scenario.states[state].actions)) })),
    globalActions: {
      actions: described(scenario, globalActions),
      except: states.filter((state) => globalActions.some((action) => !getAvailableActions(scenario, state).includes(action))),
    },
    firstInstruction: renderStateInstruction(scenario, initializeStateMachine(scenario)),
  });
}

/** What every action means, in the order the scenario defines them (global actions last). */
export function actionDescriptions(scenario: AnyScenario): { action: string; description: string }[] {
  const names = new Set([...Object.values(scenario.states).flatMap((state) => Object.keys(state.actions)), ...Object.keys(scenario.globalActions ?? {})]);
  return described(scenario, [...names]);
}
