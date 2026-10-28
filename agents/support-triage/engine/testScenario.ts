import { prompts as supportPrompts } from '../agent/prompts';
import { Scenario, ScenarioPrompts } from './types';

// A tiny scenario used only by the engine tests:
// ask_name -> ask_order -> confirm -> done, with a global "operator" action.
// Its own states, actions and system prompt; the rest of its text is the support agent's.

type S = 'ask_name' | 'ask_order' | 'confirm' | 'operator' | 'done';
type A = 'name_given' | 'order_given' | 'confirmed' | 'transfer' | 'finish';
type Ctx = { shop: string };

const shared = supportPrompts as unknown as ScenarioPrompts<S, A, Ctx>;

export const testScenario: Scenario<S, A, Ctx> = {
  id: 'test',
  label: 'Test',
  context: { shop: 'Test Pizza' },
  ultravox: { voice: 'Mark', firstSpeaker: 'agent', builtInTools: [{ toolName: 'hangUp' }] },
  prompts: {
    ...shared,
    systemPrompt: ({ context, actionsByState, globalActions, firstInstruction }) =>
      [
        `You take orders for ${context.shop}.`,
        'Valid actions by state:',
        ...actionsByState.map(({ state, actions }) => `- In "${state}": ${actions.map(({ action }) => `"${action}"`).join(', ')}`),
        `Everywhere except ${globalActions.except.join(', ')}: ${globalActions.actions.map(({ action }) => `"${action}"`).join(', ')}`,
        '## How the call starts',
        firstInstruction,
      ].join('\n'),
    states: {
      ask_name: () => ({ goal: 'Get their name.', whenDone: ['Call updateState with "name_given".'] }),
      ask_order: () => ({ goal: 'Get the order.', mustInclude: ["Today's special."] }),
      confirm: ({ callData }) => ({ goal: `Confirm ${String(callData.order)}.` }),
      operator: () => ({ goal: 'Hand off.' }),
      done: () => ({ goal: 'Say goodbye.' }),
    },
    actions: {
      name_given: 'Caller gave their name',
      order_given: 'Caller gave their order',
      confirmed: 'Order confirmed',
      transfer: 'Caller wants a person',
      finish: 'End the call',
    },
    tools: { checkStock: { description: 'Checks stock.' } },
  },
  initialState: 'ask_name',
  modelWritableKeys: ['name', 'order'],
  tools: [
    {
      name: 'checkStock',
      run: (params) => ({ result: 'in stock', callData: { stockChecked: params.item } }),
    },
  ],
  states: {
    ask_name: {
      description: 'Get the caller name',
      actions: { name_given: { nextState: 'ask_order' } },
    },
    ask_order: {
      description: 'Get the order',
      actions: {
        order_given: {
          nextState: 'confirm',
          condition: (callData) => (callData.order ? true : 'Include the order in additionalData.order.'),
        },
      },
      autoAdvance: (callData) => (callData.order ? 'order_given' : undefined),
    },
    confirm: {
      description: 'Confirm the order',
      actions: { confirmed: { nextState: 'done', updateData: () => ({ confirmed: true }) } },
    },
    operator: {
      description: 'Hand off to a person',
      actions: { finish: { nextState: 'done' } },
    },
    done: { description: 'Call over', actions: {} },
  },
  globalActions: {
    transfer: { nextState: 'operator', updateData: () => ({ transferred: true }) },
  },
};
