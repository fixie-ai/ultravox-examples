import { DecisionConfig, DEFAULT_DECISION_CONFIG } from './check';

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

/** Decision check settings from the tool server's environment. */
export function decisionConfigFromEnv(env: Record<string, string | undefined>): DecisionConfig {
  return {
    enabled: env.DECISION_CHECK !== 'off',
    acceptThreshold: number(env.DECISION_ACCEPT, DEFAULT_DECISION_CONFIG.acceptThreshold),
    floor: number(env.DECISION_FLOOR, DEFAULT_DECISION_CONFIG.floor),
    timeoutMs: number(env.DECISION_TIMEOUT_MS, DEFAULT_DECISION_CONFIG.timeoutMs),
  };
}
