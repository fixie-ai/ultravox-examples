import type { DecisionLog } from '../../engine/decision/check';

// ----------------------------------------------------------------------------- //
// Call cost estimate                                                            //
// ----------------------------------------------------------------------------- //
// Ultravox: a per-minute rate billed in fixed increments, rounded up. Default   //
// $0.05/min in 6-second increments ($0.005 each). Includes the agent's LLM and //
// voice. (Side-thread generations cost extra; the observer never generates.)   //
// Jev: billed per input token; output is free. Default $0.042 per million      //
// input tokens (TypeSafe's list price; Inworld bills "at the Jev rate").       //
// Set your own rates with the env vars in ratesFromEnv(). It's an estimate,    //
// not your invoice.                                                             //
// ----------------------------------------------------------------------------- //

export interface CostRates {
  ultravoxPerMinute: number;
  incrementSeconds: number;
  jevPerMillionInputTokens: number;
}

const DEFAULT_RATES: CostRates = {
  ultravoxPerMinute: 0.05,
  incrementSeconds: 6,
  jevPerMillionInputTokens: 0.042,
};

export interface CostEstimate {
  /** The rates used, so the UI can show its math. */
  rates: CostRates;
  ultravox: { seconds: number; increments: number; usd: number };
  jev: {
    /** Checks that reached the decision model and reported tokens. */
    calls: number;
    inputTokens: number;
    /** Checks that failed or timed out; not billed, so not counted. */
    unbilled: number;
    usd: number;
  };
  totalUsd: number;
}

export function estimateCost(durationMs: number, decisions: DecisionLog[], rates: CostRates = DEFAULT_RATES): CostEstimate {
  const seconds = Math.max(0, durationMs) / 1000;
  const increments = Math.ceil(seconds / rates.incrementSeconds);
  const perIncrement = (rates.ultravoxPerMinute * rates.incrementSeconds) / 60;
  const ultravoxUsd = increments * perIncrement;

  const billed = decisions.filter((log) => typeof log.inputTokens === 'number');
  const inputTokens = billed.reduce((sum, log) => sum + (log.inputTokens ?? 0), 0);
  const unbilled = decisions.filter((log) => log.verdict === 'fail_open' || log.verdict === 'failed').length;
  const jevUsd = (inputTokens / 1_000_000) * rates.jevPerMillionInputTokens;

  return {
    rates,
    ultravox: { seconds, increments, usd: ultravoxUsd },
    jev: { calls: billed.length, inputTokens, unbilled, usd: jevUsd },
    totalUsd: ultravoxUsd + jevUsd,
  };
}

/** Env vars for the rates. VITE_ so the browser can read them; `pnpm text-call` reads the same names. */
export const RATE_ENV_VARS = {
  ultravoxPerMinute: 'VITE_ULTRAVOX_PRICE_PER_MINUTE',
  incrementSeconds: 'VITE_ULTRAVOX_BILLING_INCREMENT_SECONDS',
  jevPerMillionInputTokens: 'VITE_JEV_PRICE_PER_MILLION_INPUT_TOKENS',
} as const;

/** Rates from env vars, falling back to the defaults. */
export function ratesFromEnv(env: Record<string, string | undefined>): CostRates {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
  };
  const incrementSeconds = number(env[RATE_ENV_VARS.incrementSeconds], DEFAULT_RATES.incrementSeconds);
  return {
    ultravoxPerMinute: number(env[RATE_ENV_VARS.ultravoxPerMinute], DEFAULT_RATES.ultravoxPerMinute),
    incrementSeconds: incrementSeconds > 0 ? incrementSeconds : DEFAULT_RATES.incrementSeconds,
    jevPerMillionInputTokens: number(env[RATE_ENV_VARS.jevPerMillionInputTokens], DEFAULT_RATES.jevPerMillionInputTokens),
  };
}

/** Dollars, with enough digits that tiny Jev costs don't show as $0.00. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toPrecision(2)}`;
}
