import { describe, expect, it, vi } from 'vitest';
import { testScenario } from '../testScenario';
import { supportScenario } from '../../agent';
import { CallState } from '../types';
import {
  buildContext,
  buildOutcomeQuestion,
  buildQuestions,
  DecideFn,
  DEFAULT_DECISION_CONFIG,
  handleCheckedUpdateState,
} from './check';
import { DecisionResult } from './types';

const at = (currentState: string, callData: CallState['callData'] = {}): CallState => ({
  currentState,
  previousState: null,
  callData: { stateHistory: [], ...callData },
});

/** A decide function that returns fixed probabilities: `{ questionId: { option: p } }`. */
const fixed =
  (probabilities: Record<string, Record<string, number>>): DecideFn =>
  async () => {
    const answers: DecisionResult = {};
    for (const [id, p] of Object.entries(probabilities)) {
      const best = Object.entries(p).sort(([, a], [, b]) => b - a)[0][0];
      answers[id] = { best, p };
    }
    return { provider: 'fixed', answers };
  };

const transcripts = [
  { speaker: 'agent', text: 'Hi, this is Riley, a virtual assistant at Acme Internet. How can I help?' },
  { speaker: 'user', text: 'Hi, I was charged twice this month.' },
];

describe('questions and context', () => {
  it('builds the outcome question from valid actions, global actions and meta outcomes', () => {
    const question = buildOutcomeQuestion(supportScenario, at('collect_details', { category: 'billing' }));
    expect(question.options).toEqual(['details_collected', 'request_human', ...Object.keys(supportScenario.prompts.decisionModel.outcomeOptions)]);
    expect(question.optionDescriptions?.request_human).toBe('The caller asks for a person');
  });

  it('adds the scenario questions for the state', () => {
    const ids = (state: string) => buildQuestions(supportScenario, at(state)).map((question) => question.id);
    expect(ids('greeting')).toEqual(['outcome', 'frustration', 'category']);
    expect(ids('classify_issue')).toEqual(['outcome', 'frustration', 'category']);
    expect(ids('self_serve')).toEqual(['outcome', 'frustration', 'fixed']);
    expect(ids('identify_account')).toEqual(['outcome', 'frustration']);
    expect(ids('ask_name')).toEqual(['outcome', 'frustration']);
    expect(buildQuestions(testScenario, at('ask_name')).map((question) => question.id)).toEqual(['outcome']);
  });

  it('labels speakers, keeps the last six turns, and includes the goal and known facts', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ speaker: i % 2 ? 'user' : 'agent', text: `line ${i}` }));
    const context = buildContext(supportScenario, at('greeting', { account: { name: 'Jordan' } }), many);
    expect(context).toContain('Current step: greeting');
    expect(context).toContain('Goal: Greet the caller');
    expect(context).toContain('Known facts: {"account":{"name":"Jordan"}}');
    expect(context).not.toContain('line 3');
    expect(context).toContain('Agent: line 4');
    expect(context).toContain('Caller: line 9');
  });
});

describe('with the heuristic provider', () => {
  it("accepts the agent's proposal when the caller's words don't point elsewhere", async () => {
    const { HeuristicProvider } = await import('./providers/heuristic');
    const heuristic = new HeuristicProvider();
    const outcome = await handleCheckedUpdateState(
      supportScenario,
      { action: 'issue_stated', additionalData: { issue_summary: 'charged twice' } },
      at('greeting'),
      { transcripts, decide: async (request) => ({ provider: 'heuristic', ...(await heuristic.decide(request)) }) }
    );
    expect(outcome.accepted).toBe(true);
    // Its category hint ("charged") also fills the category.
    expect(outcome.callState.callData.category).toBe('billing');
  });
});

describe('decision rules', () => {
  const check = (
    callState: CallState,
    params: { action: string; additionalData?: unknown },
    decide: DecideFn,
    scenario = supportScenario
  ) => handleCheckedUpdateState(scenario, params, callState, { transcripts, decide, config: DEFAULT_DECISION_CONFIG });

  it('accepts when p(proposed) >= 0.8', async () => {
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'charged twice' } },
      fixed({ outcome: { issue_stated: 0.92, not_yet: 0.08 }, frustration: { calm: 0.9, annoyed: 0.1 } })
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('identify_account');
    expect(outcome.log).toMatchObject({ verdict: 'accepted', winner: 'issue_stated', provider: 'fixed' });
  });

  it('overrides when another action wins with p >= 0.8, and says what the caller meant', async () => {
    const outcome = await check(
      at('collect_details', { category: 'billing' }),
      { action: 'details_collected' },
      fixed({ outcome: { request_human: 0.86, details_collected: 0.1, not_yet: 0.04 } })
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.callState.currentState).toBe('collect_details');
    expect(outcome.result).toContain('"request_human"');
    expect(outcome.result).toContain('the caller asks for a person');
    expect(outcome.log.verdict).toBe('overridden');
  });

  it('tells the agent to answer a side question instead of moving on', async () => {
    const outcome = await check(
      at('identify_account'),
      { action: 'continue_unverified' },
      fixed({ outcome: { caller_question: 0.9, continue_unverified: 0.1 } })
    );
    expect(outcome.result).toContain('asking a question');
    expect(outcome.log.verdict).toBe('overridden');
  });

  it('accepts below 0.8 when the proposal is the top option and clears the floor', async () => {
    // Seen live: Jev gave an obvious issue_stated 0.79.
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'internet down' } },
      fixed({ outcome: { issue_stated: 0.79, not_yet: 0.21 } })
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.log.verdict).toBe('accepted');
  });

  it('asks a clarifying question when the proposal is not the top option and nothing is confident', async () => {
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'something' } },
      fixed({ outcome: { not_yet: 0.6, issue_stated: 0.4 } })
    );
    expect(outcome.result).toContain('Not confirmed yet. Ask one short clarifying question.');
    expect(outcome.log.verdict).toBe('rejected');
    // The facts the agent sent are kept even though the state didn't change.
    expect(outcome.callState.callData.issue_summary).toBe('something');
  });

  it('fails open when the decision model is slower than the timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slow: DecideFn = (_request, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ provider: 'slow', answers: {} }), 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    const outcome = await handleCheckedUpdateState(
      supportScenario,
      { action: 'issue_stated', additionalData: { issue_summary: 'help' } },
      at('greeting'),
      { transcripts, decide: slow, config: { ...DEFAULT_DECISION_CONFIG, timeoutMs: 20 } }
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('identify_account');
    expect(outcome.log.verdict).toBe('fail_open');
    expect(outcome.log.error).toMatch(/timed out after 20 ms/);
  });

  it('fails open when the decision model errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: DecideFn = async () => {
      throw new Error('502');
    };
    const outcome = await check(at('greeting'), { action: 'issue_stated', additionalData: { issue_summary: 'help' } }, broken);
    expect(outcome.accepted).toBe(true);
    expect(outcome.log.verdict).toBe('fail_open');
  });

  it('skips the check when disabled, or when the engine would reject the action anyway', async () => {
    const decide = vi.fn(fixed({ outcome: { issue_stated: 1 } }));
    const disabled = await handleCheckedUpdateState(
      supportScenario,
      { action: 'issue_stated', additionalData: { issue_summary: 'help' } },
      at('greeting'),
      { transcripts, decide, config: { ...DEFAULT_DECISION_CONFIG, enabled: false } }
    );
    expect(disabled.accepted).toBe(true);
    expect(disabled.log.verdict).toBe('skipped');

    const invalid = await check(at('greeting'), { action: 'end_call' }, decide);
    expect(invalid.accepted).toBe(false);
    expect(invalid.result).toContain('not valid');
    expect(decide).not.toHaveBeenCalled();
  });

  it('skips the check for actions that depend on tool results (decisionCheck: false)', async () => {
    const decide = vi.fn(fixed({ outcome: { not_yet: 0.95, account_verified: 0.05 } }));
    const outcome = await check(at('identify_account', { account: { accountNumber: '100234' } }), { action: 'account_verified' }, decide);
    expect(outcome.accepted).toBe(true);
    expect(outcome.log.verdict).toBe('skipped');
    expect(decide).not.toHaveBeenCalled();
  });

  it('leaves system instructions out of the conversation it sends', () => {
    const context = buildContext(supportScenario, at('greeting'), [
      { speaker: 'user', text: 'My bill is wrong.' },
      { speaker: 'user', text: '<instruction>\nCurrent state: collect_details.\n</instruction>' },
    ]);
    expect(context).toContain('Caller: My bill is wrong.');
    expect(context).not.toContain('<instruction>');
  });

  it("doesn't let opt_out veto the agent's action: it decides on the other options", async () => {
    // Seen live: "It still does not work. / No, that's it, thanks." made opt_out the top answer.
    const outcome = await check(
      at('self_serve', { category: 'technical', kb_article: { id: 'kb' } }),
      { action: 'not_resolved' },
      fixed({ outcome: { opt_out: 0.93, not_resolved: 0.05, not_yet: 0.02 } })
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('escalate');
    expect(outcome.result).toContain('ready to wrap up');
    expect(outcome.log.note).toContain('opt_out 93% was treated as advice');
  });

  it('still asks to clarify when, without opt_out, the action is not the best option', async () => {
    const outcome = await check(
      at('self_serve', { category: 'technical', kb_article: { id: 'kb' } }),
      { action: 'issue_resolved' },
      fixed({ outcome: { opt_out: 0.9, not_yet: 0.07, issue_resolved: 0.03 } })
    );
    expect(outcome.accepted).toBe(false);
  });

  it('works with scenarios that define no decision questions', async () => {
    const outcome = await check(
      at('ask_name'),
      { action: 'name_given' },
      fixed({ outcome: { name_given: 0.95, not_yet: 0.05 } }),
      testScenario as never
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.callState.currentState).toBe('ask_order');
  });
});

describe('support decisions', () => {
  const check = (callState: CallState, params: { action: string; additionalData?: unknown }, decide: DecideFn) =>
    handleCheckedUpdateState(supportScenario, params, callState, { transcripts, decide, config: DEFAULT_DECISION_CONFIG });

  it('keeps the agent\'s issue summary instead of the caller\'s last line', async () => {
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'Charged twice in September' } },
      fixed({ outcome: { issue_stated: 0.95 } })
    );
    expect(outcome.callState.callData.issue_summary).toBe('Charged twice in September');
  });

  it('keeps the agent\'s details when the check rejects the action ("jev" details mode)', async () => {
    const outcome = await handleCheckedUpdateState(
      supportScenario,
      { action: 'details_collected', additionalData: { details: { charge_amount: '$12' } } },
      at('collect_details', { category: 'billing', details: { billing_problem: 'unrecognized charge' } }),
      {
        transcripts: [{ speaker: 'user', text: 'It was on September 1st.' }],
        decide: fixed({ outcome: { not_yet: 0.9 }, 'field:charge_date': { yes: 0.95, no: 0.05 } }),
        config: DEFAULT_DECISION_CONFIG,
        detailsMode: 'jev',
      }
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.callState.callData.details).toEqual({
      billing_problem: 'unrecognized charge',
      charge_amount: '$12',
      charge_date: 'It was on September 1st.',
    });
  });

  it('fills the category from the decision model, not from the agent', async () => {
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'charged twice', category: 'technical' } },
      fixed({
        outcome: { issue_stated: 0.95, not_yet: 0.05 },
        frustration: { calm: 0.9, annoyed: 0.1 },
        category: { billing: 0.91, technical: 0.04, unclear: 0.05 },
      })
    );
    expect(outcome.callState.callData.category).toBe('billing');
    expect(outcome.log.extras?.category).toEqual(['billing', 0.91]);
  });

  it("keeps the agent's category when the decision model isn't confident", async () => {
    const outcome = await check(
      at('greeting'),
      { action: 'issue_stated', additionalData: { issue_summary: 'charged twice', category: 'billing' } },
      fixed({ outcome: { issue_stated: 0.95 }, category: { billing: 0.55, unclear: 0.45 } })
    );
    expect(outcome.callState.callData.category).toBe('billing');
  });

  it('skips classify_issue when the decision model is sure of the category', async () => {
    const outcome = await check(
      at('classify_issue', { issue_summary: 'my wifi keeps dropping' }),
      { action: 'issue_classified', additionalData: { category: 'other' } },
      fixed({ outcome: { issue_classified: 0.9 }, category: { technical: 0.88, other: 0.12 } })
    );
    expect(outcome.callState.callData.category).toBe('technical');
    expect(outcome.callState.currentState).toBe('collect_details');
  });

  it('records an angry caller and offers a person right away', async () => {
    const outcome = await check(
      at('identify_account'),
      { action: 'continue_unverified' },
      fixed({ outcome: { continue_unverified: 0.9 }, frustration: { angry: 0.87, annoyed: 0.1, calm: 0.03 } })
    );
    expect(outcome.callState.callData.frustration).toBe('angry');
    expect(outcome.result).toContain('The caller sounds angry');
    // The next state's goal now includes the shortcut to a person.
    expect(outcome.result).toContain('offer to connect them with a person now ("request_human")');
  });

  it('scores frustration even when the action is rejected', async () => {
    const outcome = await check(
      at('collect_details', { category: 'billing' }),
      { action: 'details_collected' },
      fixed({ outcome: { not_yet: 0.9, details_collected: 0.1 }, frustration: { angry: 0.9, calm: 0.1 } })
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.callState.callData.frustration).toBe('angry');
    expect(outcome.result).toContain('The caller sounds angry');
  });

  it('uses high priority for an angry caller once escalated', async () => {
    const outcome = await check(
      at('collect_details', { category: 'billing', frustration: 'angry' }),
      { action: 'request_human' },
      fixed({ outcome: { request_human: 0.95 }, frustration: { angry: 0.9 } })
    );
    expect(outcome.callState.currentState).toBe('escalate');
    expect(outcome.result).toContain('use priority "high"');
  });

  it('vetoes issue_resolved when the caller said it still does not work', async () => {
    const outcome = await check(
      at('self_serve', { category: 'technical', kb_article: { id: 'kb-restart-router' } }),
      { action: 'issue_resolved' },
      fixed({ outcome: { issue_resolved: 0.85, not_resolved: 0.15 }, fixed: { no: 0.9, yes: 0.1 } })
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.result).toContain('Use "not_resolved"');
  });
});
