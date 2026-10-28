import { describe, expect, it } from 'vitest';
import { CallState } from './types';
import { buildCallTemplate, buildMainTool } from './ultravoxTools';
import { supportScenario } from '../agent';
import {
  buildSystemPrompt,
  renderStateInstruction,
} from './prompt';
import {
  getAllActions,
  getAvailableActions,
  initializeStateMachine,
  transition,
  TransitionError,
} from './stateMachine';
import { testScenario as scenario } from './testScenario';
import { runScenarioTool } from './tools';
import { handleUpdateState, mergeModelData } from './updateState';

const at = (currentState: string, callData: CallState['callData'] = { stateHistory: [] }): CallState => ({
  currentState,
  previousState: null,
  callData,
});

describe('transition', () => {
  it('starts in the scenario initial state', () => {
    expect(initializeStateMachine(scenario)).toEqual(at('ask_name'));
  });

  it('applies a valid action and records history', () => {
    const { callState, steps } = transition(scenario, at('ask_name'), 'name_given');
    expect(callState.currentState).toBe('ask_order');
    expect(callState.previousState).toBe('ask_name');
    expect(callState.callData.stateHistory).toEqual(['ask_name']);
    expect(steps).toEqual([{ from: 'ask_name', action: 'name_given', to: 'ask_order', automatic: false }]);
  });

  it('throws an invalid_action error for an action the state does not define', () => {
    expect(() => transition(scenario, at('ask_name'), 'confirmed')).toThrow(TransitionError);
    try {
      transition(scenario, at('ask_name'), 'confirmed');
    } catch (error) {
      expect((error as TransitionError).code).toBe('invalid_action');
    }
  });

  it('throws the condition reason when a condition blocks the action', () => {
    try {
      transition(scenario, at('ask_order'), 'order_given');
      expect.unreachable();
    } catch (error) {
      expect((error as TransitionError).code).toBe('condition_failed');
      expect((error as TransitionError).reason).toBe('Include the order in additionalData.order.');
    }
  });

  it('applies updateData', () => {
    const { callState } = transition(scenario, at('confirm', { order: 'pizza' }), 'confirmed');
    expect(callState.callData.confirmed).toBe(true);
  });

  it('auto-advances through a state whose question is already answered', () => {
    const { callState, steps } = transition(scenario, at('ask_name', { order: 'pizza' }), 'name_given');
    expect(callState.currentState).toBe('confirm');
    expect(callState.callData.stateHistory).toEqual(['ask_name', 'ask_order']);
    expect(steps.map((step) => step.automatic)).toEqual([false, true]);
  });
});

describe('global actions', () => {
  it('are available in every non-terminal state', () => {
    expect(getAvailableActions(scenario, 'ask_name')).toEqual(['name_given', 'transfer']);
    expect(getAvailableActions(scenario, 'confirm')).toEqual(['confirmed', 'transfer']);
  });

  it('are not available in terminal states or the state they lead to', () => {
    expect(getAvailableActions(scenario, 'done')).toEqual([]);
    expect(getAvailableActions(scenario, 'operator')).toEqual(['finish']);
  });

  it('transition from any state and keep the data collected so far', () => {
    const { callState } = transition(scenario, at('confirm', { stateHistory: ['ask_name'], order: 'pizza' }), 'transfer');
    expect(callState.currentState).toBe('operator');
    expect(callState.callData).toMatchObject({ order: 'pizza', transferred: true });
  });

  it('are included in the tool enum and in every non-terminal state', () => {
    expect(getAllActions(scenario)).toContain('transfer');
    expect(getAvailableActions(scenario, 'ask_name')).toEqual(['name_given', 'transfer']);
  });
});

describe('mergeModelData', () => {
  it('keeps only allowed keys', () => {
    expect(mergeModelData({}, { name: 'Sam', stateHistory: ['x'], confirmed: true }, ['name'])).toEqual({ name: 'Sam' });
  });

  it('merges object values instead of replacing them', () => {
    const merged = mergeModelData({ order: { size: 'L' } }, { order: { topping: 'olives' } }, ['order']);
    expect(merged.order).toEqual({ size: 'L', topping: 'olives' });
  });

  it('ignores empty values and non-object input', () => {
    expect(mergeModelData({ name: 'Sam' }, { name: '' }, ['name'])).toEqual({ name: 'Sam' });
    expect(mergeModelData({}, 'nope', ['name'])).toEqual({});
  });
});

describe('handleUpdateState', () => {
  it('returns the next state instruction, without repeating acknowledgements', () => {
    const outcome = handleUpdateState(scenario, { action: 'name_given' }, at('ask_name'));
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('ask_order');
    expect(outcome.result).toMatch(/^<instruction>/);
    expect(outcome.result).toContain('Goal: Get the order.');
    expect(outcome.result).toContain('Continue naturally from what you just said.');
  });

  it('skips states using data from the same call and says so', () => {
    const outcome = handleUpdateState(
      scenario,
      { action: 'name_given', additionalData: { name: 'Sam', order: 'pizza' } },
      at('ask_name')
    );
    expect(outcome.callState.currentState).toBe('confirm');
    expect(outcome.result).toContain('Skipped "ask_order"');
  });

  it('rejects with the reason but keeps allowed data', () => {
    const outcome = handleUpdateState(scenario, { action: 'order_given', additionalData: { name: 'Sam' } }, at('ask_order'));
    expect(outcome.accepted).toBe(false);
    expect(outcome.result).toBe('Error: Include the order in additionalData.order.');
    expect(outcome.callState.currentState).toBe('ask_order');
    expect(outcome.callState.callData.name).toBe('Sam');
  });

  it('cannot overwrite engine-owned fields', () => {
    const outcome = handleUpdateState(
      scenario,
      { action: 'name_given', additionalData: { stateHistory: ['hacked'], confirmed: true } },
      at('ask_name')
    );
    expect(outcome.callState.callData.stateHistory).toEqual(['ask_name']);
    expect(outcome.callState.callData.confirmed).toBeUndefined();
  });

  it('rejects a missing action', () => {
    expect(handleUpdateState(scenario, {}, at('ask_name')).accepted).toBe(false);
  });
});

describe('generated prompt text', () => {
  const quoted = (text: string) => [...text.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const known = new Set([...getAllActions(scenario), ...Object.keys(scenario.states)]);

  it('only names actions and states that exist', () => {
    for (const name of quoted(buildSystemPrompt(scenario))) expect(known).toContain(name);
    const action = buildMainTool(scenario, { baseUrl: 'https://t' }).temporaryTool.dynamicParameters[0];
    for (const name of quoted(String(action.schema.description))) expect(known).toContain(name);
  });

  it('lists every action, including global ones', () => {
    const prompt = buildSystemPrompt(scenario);
    for (const action of getAllActions(scenario)) expect(prompt).toContain(`"${action}"`);
  });

  it('tells the agent it may answer side questions without calling updateState', () => {
    expect(buildSystemPrompt(supportScenario)).toMatch(/side question/i);
  });

  it('formats goals with the four sections', () => {
    const text = scenario.prompts.goal({ goal: 'G', mustInclude: ['M'], dont: ['D'], whenDone: ['W'] });
    expect(text).toMatch(/^Goal: G\nMust include: M\nDon't: D .*Re-ask.*\nWhen done: W$/);
  });

  it('lists valid actions in non-terminal state instructions only', () => {
    expect(renderStateInstruction(scenario, at('ask_name'))).toContain('Valid actions now: name_given, transfer.');
    expect(renderStateInstruction(scenario, at('done'))).not.toContain('Valid actions now');
  });
});

describe('buildCallTemplate', () => {
  const server = { baseUrl: 'https://tools.example.com/' };
  const template = () => buildCallTemplate(scenario, server);
  const toolName = (tool: object) =>
    'toolName' in tool ? (tool as { toolName: string }).toolName : (tool as { temporaryTool: { modelToolName: string } }).temporaryTool.modelToolName;

  it('lets the agent speak first, with the first goal in the system prompt and no tool call', () => {
    const config = template();
    expect(config.firstSpeakerSettings).toEqual({ agent: {} });
    expect(config.systemPrompt).toContain('## How the call starts');
    expect(config.systemPrompt).toContain('Goal: Get their name.');
    expect(config).not.toHaveProperty('initialMessages');
    expect(config).not.toHaveProperty('initialState');
  });

  it('gives the agent hangUp, updateState, the scenario tools and the observer tool', () => {
    expect(template().selectedTools.map(toolName)).toEqual(['hangUp', 'updateState', 'checkStock', 'observeTurn']);
  });

  it('makes every tool an HTTP tool on the tool server with call state, conversation and call id', () => {
    const tool = buildMainTool(scenario, server).temporaryTool;
    expect(tool.http).toEqual({ baseUrlPattern: 'https://tools.example.com/tools/updateState', httpMethod: 'POST' });
    expect(tool.staticParameters).toEqual([]);
    expect(tool.automaticParameters.map((p) => p.knownValue)).toEqual([
      'KNOWN_PARAM_CALL_STATE',
      'KNOWN_PARAM_CONVERSATION_HISTORY',
      'KNOWN_PARAM_CALL_ID',
      'KNOWN_PARAM_CALL_METADATA',
    ]);
  });

  it('sets the model only when one is given', () => {
    expect(template()).not.toHaveProperty('model');
    expect(buildCallTemplate(scenario, server, { model: 'ultravox-v0.7' }).model).toBe('ultravox-v0.7');
  });

  it('makes the agent speak after the main tool only if it didn\'t speak just before the call', () => {
    expect(buildMainTool(scenario, server).temporaryTool.defaultReaction).toBe('AGENT_REACTION_SPEAKS_ONCE');
  });

  it('sends the tool server secret as a header with every HTTP tool', () => {
    const tools = buildCallTemplate(scenario, { ...server, secret: 's3cret' }).selectedTools.filter((tool) => 'temporaryTool' in tool);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect((tool as { temporaryTool: { staticParameters: unknown[] } }).temporaryTool.staticParameters).toContainEqual({
        name: 'X-Tool-Secret',
        location: 'PARAMETER_LOCATION_HEADER',
        value: 's3cret',
      });
    }
    expect(JSON.stringify(template())).not.toContain('X-Tool-Secret');
  });
});

describe('runScenarioTool', () => {
  it('returns the result and merges call data', async () => {
    const outcome = await runScenarioTool(scenario, 'checkStock', { item: 'pizza' }, at('ask_order'));
    expect(outcome.result).toBe('in stock');
    expect(outcome.callState.callData.stockChecked).toBe('pizza');
  });

  it('throws for an unknown tool', async () => {
    await expect(runScenarioTool(scenario, 'nope', {}, at('ask_order'))).rejects.toThrow(/Unknown tool/);
  });
});
