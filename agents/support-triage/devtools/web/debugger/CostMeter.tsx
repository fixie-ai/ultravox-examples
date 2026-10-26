import React from 'react';
import { CostEstimate, formatUsd, RATE_ENV_VARS } from '../../shared/cost';
import { TimingSource } from '../hooks/useCallTiming';

interface CostMeterProps {
  cost: CostEstimate;
  /** "live" while the call runs; "final" once Ultravox's join/end times are loaded; "loading" while waiting for them. */
  source: TimingSource;
  /** Side-thread LLM generations (e.g. the extraction thread); billed by tokens, not included in the estimate. */
  sideGenerations?: number;
}

/** Estimated call cost: Ultravox minutes plus Jev input tokens, at the configured rates. */
const CostMeter: React.FC<CostMeterProps> = ({ cost, source, sideGenerations = 0 }) => {
  const { ultravox, jev, rates } = cost;
  const perIncrement = (rates.ultravoxPerMinute * rates.incrementSeconds) / 60;
  const detail = [
    `Ultravox: ${ultravox.seconds.toFixed(1)}s → ${ultravox.increments} × ${rates.incrementSeconds}s × ${formatUsd(perIncrement)} = ${formatUsd(ultravox.usd)}`,
    `  (rate $${rates.ultravoxPerMinute}/min, billed per ${rates.incrementSeconds}s, rounded up)`,
    `Jev: ${jev.calls} checks, ${jev.inputTokens.toLocaleString()} input tokens × $${rates.jevPerMillionInputTokens}/M = ${formatUsd(jev.usd)}`,
    jev.unbilled ? `${jev.unbilled} failed or timed-out checks (not billed)` : '',
    sideGenerations ? `${sideGenerations} side-thread generations: billed by tokens, not included here` : '',
    source === 'final'
      ? 'Duration from Ultravox join/end times.'
      : source === 'live'
        ? 'Live: running time so far.'
        : source === 'loading'
          ? "Loading Ultravox's join/end times…"
          : "From the local clock (Ultravox's times weren't available).",
    `Estimate at the rates in ${RATE_ENV_VARS.ultravoxPerMinute}, ${RATE_ENV_VARS.incrementSeconds} and`,
    `${RATE_ENV_VARS.jevPerMillionInputTokens}; not your invoice.`,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className="flex items-center gap-1.5 font-mono" title={detail}>
      <span className="text-slate-400">Estimated cost</span>
      <span className="text-emerald-300 font-semibold">{formatUsd(cost.totalUsd)}</span>
      <span className="text-slate-400">
        = Ultravox {formatUsd(ultravox.usd)} ({Math.ceil(ultravox.seconds)}s) + Jev {formatUsd(jev.usd)} ({jev.inputTokens.toLocaleString()} tok)
        {sideGenerations ? ` + ${sideGenerations} side generations` : ''}
      </span>
    </span>
  );
};

export default CostMeter;
