// Types for the decision model: the questions the decision checks ask, and what providers answer.

/** One multiple-choice question for the decision model. */
export interface DecisionQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** What each option means. Sent to the model as the option's criteria. */
  optionDescriptions?: Record<string, string>;
  /** Keywords per option, used only by the offline `heuristic` provider. */
  hints?: Record<string, string[]>;
  /** The heuristic provider's answer when no hint matches. */
  fallback?: string;
}

export interface DecisionAnswer {
  best: string;
  /** Probability per option. Sums to about 1. */
  p: Record<string, number>;
}

export type DecisionResult = Record<string, DecisionAnswer>;

export interface DecisionRequest {
  /** What the model judges: recent conversation plus known facts. */
  context: string;
  questions: DecisionQuestion[];
}

/** A provider's answers plus what it cost. */
export interface DecisionOutput {
  answers: DecisionResult;
  /** The exact model version that answered, if the provider reports it. */
  model?: string;
  /** Billed input tokens (Jev bills input tokens only). 0 for the offline heuristic. */
  inputTokens?: number;
}

export interface DecisionProvider {
  name: string;
  decide(input: DecisionRequest, signal?: AbortSignal): Promise<DecisionOutput>;
}
