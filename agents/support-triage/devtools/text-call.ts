import { DETAILS_MODES, isDetailsMode } from '../engine/decision/extraction';
import { isObserverSetting, OBSERVER_SETTINGS } from '../engine/observer/settings';
import { formatCost, runTextCall } from './textCall';

// Plays a scripted caller against the running agent, in text (needs `pnpm dev`):
//   pnpm text-call                                   # default script
//   pnpm text-call --observer thread "My internet is down." "100871"

const DEFAULT_SCRIPT = [
  'Hi, I was charged twice this month, 79.99 on September 1st.',
  'Account 100234.',
  "Oh, so it's just pending. Got it, thanks. That's all.",
];

// Flags: --model <ultravox model>, --observer off|thread|dataconnection,
// --details agent|jev|extract; the rest are caller lines.
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
const lines: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i];
  else lines.push(args[i]);
}
const observer = flags.observer ?? 'off';
const details = flags.details ?? 'agent';
if (!isObserverSetting(observer) || !isDetailsMode(details)) {
  console.error(`Flags: --model <name>, --observer ${OBSERVER_SETTINGS.join('|')}, --details ${DETAILS_MODES.join('|')}.`);
  process.exit(1);
}

const result = await runTextCall({
  model: flags.model,
  observer,
  details,
  lines: lines.length ? lines : DEFAULT_SCRIPT,
  verbose: true,
});
console.log(`\npath: ${result.path.join(' → ')}`);
console.log(
  `final state: ${result.finalState}${result.stuck ? ' (stuck: the agent stopped replying)' : ''}${result.ended ? ' (the agent ended the call)' : ''}`
);
console.log(
  `timing: ${result.timings.responses} agent responses, average ${result.timings.averageResponseSeconds.toFixed(2)} s; ` +
    `${result.timings.toolCalls} tool calls, average ${Math.round(result.timings.averageToolMs)} ms`
);
console.log(formatCost(result.cost));
process.exit(0);
