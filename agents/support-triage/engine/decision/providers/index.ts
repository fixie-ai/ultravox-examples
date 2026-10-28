import type { DecideFn } from '../check';
import { DecisionProvider } from '../types';
import { HeuristicProvider } from './heuristic';
import { JevProvider } from './jev';

export type ProviderEnv = Record<string, string | undefined> & {
  DECISION_PROVIDER?: string;
  DECISION_MODEL?: string;
  INWORLD_API_KEY?: string;
  INWORLD_BASE_URL?: string;
};

/**
 * Picks the provider from DECISION_PROVIDER ("jev" or "heuristic"). With no
 * setting, uses Jev when INWORLD_API_KEY is set and the heuristic otherwise.
 */
export function createProvider(env: ProviderEnv): DecisionProvider {
  const name = env.DECISION_PROVIDER || (env.INWORLD_API_KEY ? 'jev' : 'heuristic');
  if (name === 'heuristic') return new HeuristicProvider();
  if (name === 'jev') {
    if (!env.INWORLD_API_KEY) throw new Error('DECISION_PROVIDER=jev needs INWORLD_API_KEY.');
    return new JevProvider({ apiKey: env.INWORLD_API_KEY, model: env.DECISION_MODEL, baseUrl: env.INWORLD_BASE_URL });
  }
  throw new Error(`Unknown DECISION_PROVIDER "${name}". Use "jev" or "heuristic".`);
}

/** The provider from `env`, as the DecideFn the decision checks call (labels each result with the provider). */
export function createDecideFn(env: ProviderEnv): { decide: DecideFn; providerName: string } {
  const provider = createProvider(env);
  const decide: DecideFn = async (request, signal) => {
    const output = await provider.decide(request, signal);
    return { provider: output.model ? `${provider.name} (${output.model})` : provider.name, ...output };
  };
  return { decide, providerName: provider.name };
}
