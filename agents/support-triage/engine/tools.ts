import { AnyScenario, CallState } from './types';
import { renderStateInstruction } from './prompt';
import { settle, TransitionStep } from './stateMachine';
import { describeSteps } from './updateState';

export interface ToolOutcome {
  result: string;
  callState: CallState;
  /** States the call moved through because of the tool's data. */
  steps: TransitionStep[];
}

/**
 * Runs one of the scenario's tools and merges any call data it returns. That data may let the call move on
 * (e.g. the lookup found the account), so the call then settles, and the result tells the agent if it did.
 */
export async function runScenarioTool(
  scenario: AnyScenario,
  name: string,
  params: Record<string, unknown>,
  callState: CallState
): Promise<ToolOutcome> {
  const tool = scenario.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const { result, callData } = await tool.run(params, { callData: callState.callData, context: scenario.context });
  const merged = callData ? { ...callState, callData: { ...callState.callData, ...callData } } : callState;
  const settled = settle(scenario, merged);
  if (settled.steps.length === 0) return { result, callState: merged, steps: [] };
  const instruction = renderStateInstruction(scenario, settled.callState, {
    afterToolCall: true,
    note: describeSteps(scenario, settled.steps),
  });
  return { result: `${result}\n${instruction}`, callState: settled.callState, steps: settled.steps };
}
