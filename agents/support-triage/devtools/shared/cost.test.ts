import { describe, expect, it } from 'vitest';
import type { DecisionLog } from '../../engine/decision/check';
import { estimateCost, formatUsd, ratesFromEnv } from './cost';

const log = (verdict: DecisionLog['verdict'], inputTokens?: number): DecisionLog => ({
  source: 'updateState',
  at: '',
  state: 'greeting',
  proposed: 'issue_stated',
  verdict,
  latencyMs: 200,
  inputTokens,
});

describe('estimateCost', () => {
  it('bills Ultravox in 6-second increments, rounded up', () => {
    expect(estimateCost(0, []).ultravox).toEqual({ seconds: 0, increments: 0, usd: 0 });
    expect(estimateCost(1, []).ultravox.increments).toBe(1);
    expect(estimateCost(6000, []).ultravox.increments).toBe(1);
    expect(estimateCost(6001, []).ultravox.increments).toBe(2);
    expect(estimateCost(60_000, []).ultravox.usd).toBeCloseTo(0.05);
    expect(estimateCost(15_200, []).ultravox.usd).toBeCloseTo(0.015); // 3 increments
  });

  it('bills Jev input tokens at $0.042 per million and skips failed checks', () => {
    const cost = estimateCost(0, [log('accepted', 1000), log('applied', 500), log('fail_open'), log('skipped')]);
    expect(cost.jev).toMatchObject({ calls: 2, inputTokens: 1500, unbilled: 1 });
    expect(cost.jev.usd).toBeCloseTo(0.000063);
  });

  it('adds both into the total', () => {
    const cost = estimateCost(30_000, [log('accepted', 1_000_000)]);
    expect(cost.totalUsd).toBeCloseTo(0.025 + 0.042);
  });

  it('reads rate overrides from the environment', () => {
    const rates = ratesFromEnv({
      VITE_ULTRAVOX_PRICE_PER_MINUTE: '0.07',
      VITE_ULTRAVOX_BILLING_INCREMENT_SECONDS: '60',
      VITE_JEV_PRICE_PER_MILLION_INPUT_TOKENS: '0.1',
    });
    expect(rates).toEqual({ ultravoxPerMinute: 0.07, incrementSeconds: 60, jevPerMillionInputTokens: 0.1 });
    expect(ratesFromEnv({})).toEqual({ ultravoxPerMinute: 0.05, incrementSeconds: 6, jevPerMillionInputTokens: 0.042 });
    expect(ratesFromEnv({ VITE_ULTRAVOX_BILLING_INCREMENT_SECONDS: '0' }).incrementSeconds).toBe(6);
  });

  it('uses the given rates', () => {
    // $0.07/min in whole minutes: 61 s is two minutes.
    const cost = estimateCost(61_000, [], { ultravoxPerMinute: 0.07, incrementSeconds: 60, jevPerMillionInputTokens: 0 });
    expect(cost.ultravox).toMatchObject({ increments: 2 });
    expect(cost.ultravox.usd).toBeCloseTo(0.14);
  });
});

describe('formatUsd', () => {
  it('keeps small amounts readable', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.035)).toBe('$0.035');
    expect(formatUsd(0.0000126)).toBe('$0.000013');
  });
});
