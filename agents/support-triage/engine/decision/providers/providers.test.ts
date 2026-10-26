import { describe, expect, it, vi } from 'vitest';
import { DecisionRequest } from '../types';
import { createProvider } from '.';
import { callerText, HeuristicProvider } from './heuristic';
import { fromJevResponse, JevProvider, toJevRequest } from './jev';

const request: DecisionRequest = {
  context: 'Current step: greeting\nConversation (most recent last):\nAgent: Hi!\nCaller: My bill is wrong, I was charged twice.',
  questions: [
    {
      id: 'category',
      prompt: 'Which kind of issue?',
      options: ['billing', 'technical', 'unclear'],
      optionDescriptions: { billing: 'Charges', technical: 'Internet problems' },
      hints: { billing: ['charged', 'bill'], technical: ['wifi'] },
      fallback: 'unclear',
    },
    { id: 'mood', prompt: 'Mood?', options: ['calm', 'angry'], hints: { angry: ['furious'] }, fallback: 'calm' },
  ],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Jev provider', () => {
  it('maps questions to Inworld "choice" questions with criteria', () => {
    expect(toJevRequest('typesafe/jev-latest', request)).toEqual({
      model: 'typesafe/jev-latest',
      state: request.context,
      questions: {
        category: {
          type: 'choice',
          instructions: 'Which kind of issue?',
          criteria: { billing: 'Charges', technical: 'Internet problems', unclear: null },
        },
        mood: { type: 'choice', instructions: 'Mood?', criteria: { calm: null, angry: null } },
      },
    });
  });

  it('maps choice answers to best + probabilities', () => {
    expect(
      fromJevResponse({
        model: 'typesafe/jev-1.13.0',
        answers: {
          category: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.8 },
        },
      })
    ).toEqual({ category: { best: 'billing', p: { billing: 0.88, technical: 0.12 } } });
  });

  it('calls /alpha/decisions with the Inworld key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: 'typesafe/jev-1.13.0',
        answers: { mood: { type: 'choice', choice: 'calm', probabilities: { calm: 1 } } },
        usage: { input_tokens: 318, output_tokens: 34 },
      })
    );
    const provider = new JevProvider({ apiKey: 'abc=', fetch: fetchMock as unknown as typeof fetch });
    const output = await provider.decide(request);
    expect(output.answers.mood.best).toBe('calm');
    expect(output.model).toBe('typesafe/jev-1.13.0');
    expect(output.inputTokens).toBe(318);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.inworld.ai/alpha/decisions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc=');
    expect(JSON.parse(init.body as string).model).toBe('typesafe/jev-latest');
  });

  it('throws with the status and body on an error', async () => {
    const fetchMock = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    const provider = new JevProvider({ apiKey: 'bad', fetch: fetchMock as unknown as typeof fetch });
    await expect(provider.decide(request)).rejects.toThrow('401: Unauthorized');
  });
});

describe('heuristic provider', () => {
  it("reads only the caller's recent lines", () => {
    expect(callerText(request.context)).toBe('caller: my bill is wrong, i was charged twice.');
  });

  it('picks the option with the most hints, else the fallback', async () => {
    const { answers, inputTokens } = await new HeuristicProvider().decide(request);
    expect(inputTokens).toBe(0);
    expect(answers.category.best).toBe('billing');
    expect(answers.category.p.billing).toBe(0.85);
    expect(answers.mood.best).toBe('calm');
    const total = Object.values(answers.category.p).reduce((sum: number, p: number) => sum + p, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('createProvider', () => {
  it('uses Jev when an Inworld key is set, otherwise the heuristic', () => {
    expect(createProvider({ INWORLD_API_KEY: 'k' }).name).toBe('jev');
    expect(createProvider({}).name).toBe('heuristic');
    expect(createProvider({ DECISION_PROVIDER: 'heuristic', INWORLD_API_KEY: 'k' }).name).toBe('heuristic');
  });

  it('rejects bad settings', () => {
    expect(() => createProvider({ DECISION_PROVIDER: 'jev' })).toThrow(/INWORLD_API_KEY/);
    expect(() => createProvider({ DECISION_PROVIDER: 'nonexistent' })).toThrow(/Unknown/);
  });
});
