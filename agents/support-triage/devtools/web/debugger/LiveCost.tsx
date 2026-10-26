import React from 'react';
import type { DecisionLog } from '../../../engine/decision/check';
import { estimateCost, ratesFromEnv } from '../../shared/cost';
import { useCallTiming } from '../hooks/useCallTiming';
import CostMeter from './CostMeter';

const costRates = ratesFromEnv(import.meta.env);

interface LiveCostProps {
  callId?: string;
  callActive: boolean;
  viewOnly: boolean;
  streamEndedAt?: number;
  decisions: DecisionLog[];
  sideGenerations: number;
}

/** The cost meter with its own clock: while a call runs it re-renders every second, and the rest of the app doesn't. */
const LiveCost: React.FC<LiveCostProps> = ({ callId, callActive, viewOnly, streamEndedAt, decisions, sideGenerations }) => {
  const timing = useCallTiming(callId, { callActive, viewOnly, streamEndedAt });
  return <CostMeter cost={estimateCost(timing.durationMs, decisions, costRates)} source={timing.source} sideGenerations={sideGenerations} />;
};

export default LiveCost;
