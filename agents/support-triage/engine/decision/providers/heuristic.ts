import { DecisionOutput, DecisionProvider, DecisionRequest, DecisionResult } from '../types';

// Keyword stub for tests and offline development. It reads only the caller's
// last two turns and looks for each question's `hints`. With no hit it picks
// the question's `fallback`. It is not a classifier; it keeps the app usable
// without credentials.

const CONFIDENT = 0.85;

/** The caller's most recent lines from a context built by buildContext(). */
export function callerText(context: string, turns = 2): string {
  return context
    .split('\n')
    .filter((line) => line.startsWith('Caller:'))
    .slice(-turns)
    .join(' ')
    .toLowerCase();
}

export class HeuristicProvider implements DecisionProvider {
  readonly name = 'heuristic';

  async decide(request: DecisionRequest): Promise<DecisionOutput> {
    const text = callerText(request.context);
    const result: DecisionResult = {};
    for (const question of request.questions) {
      const hits = question.options.map(
        (option) => (question.hints?.[option] ?? []).filter((hint) => text.includes(hint)).length
      );
      const top = Math.max(...hits);
      const best =
        top > 0 ? question.options[hits.indexOf(top)] : (question.fallback ?? question.options[question.options.length - 1]);
      const rest = (1 - CONFIDENT) / Math.max(question.options.length - 1, 1);
      result[question.id] = {
        best,
        p: Object.fromEntries(question.options.map((option) => [option, option === best ? CONFIDENT : rest])),
      };
    }
    return { answers: result, inputTokens: 0 };
  }
}
