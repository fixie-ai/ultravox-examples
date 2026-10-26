import { DecisionOutput, DecisionProvider, DecisionQuestion, DecisionRequest, DecisionResult } from '../types';

// TypeSafe's Jev decision model through Inworld's Decisions API:
// https://docs.inworld.ai/router/decisions
// Each DecisionQuestion becomes a "choice" question; Jev returns a probability
// for every option in one pass.

export const DEFAULT_JEV_MODEL = 'typesafe/jev-latest';
export const DEFAULT_INWORLD_BASE_URL = 'https://api.inworld.ai';

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Builds the Inworld Decisions request body. */
export function toJevRequest(model: string, request: DecisionRequest) {
  return {
    model,
    state: request.context,
    questions: Object.fromEntries(
      request.questions.map((question: DecisionQuestion) => [
        question.id,
        {
          type: 'choice',
          instructions: question.prompt,
          criteria: Object.fromEntries(
            question.options.map((option) => [option, question.optionDescriptions?.[option] ?? null])
          ),
        },
      ])
    ),
  };
}

export function fromJevResponse(response: JevResponse): DecisionResult {
  return Object.fromEntries(
    Object.entries(response.answers).map(([id, answer]) => [id, { best: answer.choice, p: answer.probabilities }])
  );
}

export class JevProvider implements DecisionProvider {
  readonly name = 'jev';

  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    }
  ) {}

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionOutput> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.options.baseUrl ?? DEFAULT_INWORLD_BASE_URL}/alpha/decisions`, {
      method: 'POST',
      headers: {
        // The Inworld Portal credential is already base64(key_id:secret).
        Authorization: `Basic ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toJevRequest(this.options.model ?? DEFAULT_JEV_MODEL, request)),
      signal,
    });
    if (!response.ok) {
      // The error ends up in the call state (every tool response carries it), so keep it short.
      throw new Error(`Inworld Decisions API returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as JevResponse;
    return { answers: fromJevResponse(body), model: body.model, inputTokens: body.usage?.input_tokens };
  }
}
