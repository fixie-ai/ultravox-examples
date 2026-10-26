import { expect } from 'vitest';
import { AnyScenario, CallState } from './types';
import { initializeStateMachine } from './stateMachine';
import { runScenarioTool } from './tools';
import { handleUpdateState } from './updateState';

/**
 * Plays the model's side of a call against the engine: tool calls and
 * updateState actions, in order, as the tool server runs them. For tests
 * (e.g. a scenario's sample dialogs).
 */
export class CallDriver {
  callState: CallState;
  lastResult = '';

  constructor(private readonly scenario: AnyScenario) {
    this.callState = initializeStateMachine(scenario);
  }

  /** Every state the call has been in, in order, including the current one. */
  get path(): string[] {
    return [...(this.callState.callData.stateHistory ?? []), this.callState.currentState];
  }

  get data() {
    return this.callState.callData;
  }

  /** The model calls updateState and expects it to be accepted. */
  act(action: string, additionalData?: Record<string, unknown>): this {
    const outcome = handleUpdateState(this.scenario, { action, additionalData }, this.callState);
    expect(outcome.accepted, `${action} rejected: ${outcome.result}`).toBe(true);
    this.callState = outcome.callState;
    this.lastResult = outcome.result;
    return this;
  }

  /** The model calls updateState and expects a rejection. */
  rejected(action: string, additionalData?: Record<string, unknown>): string {
    const outcome = handleUpdateState(this.scenario, { action, additionalData }, this.callState);
    expect(outcome.accepted).toBe(false);
    this.callState = outcome.callState;
    return outcome.result;
  }

  /** The model calls one of the scenario's tools (the call may move on). Returns the tool's own JSON result. */
  async tool(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await runScenarioTool(this.scenario, name, params, this.callState);
    this.callState = outcome.callState;
    this.lastResult = outcome.result;
    return JSON.parse(outcome.result.split('\n')[0]);
  }
}
