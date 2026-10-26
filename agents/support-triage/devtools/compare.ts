import fs from 'node:fs';
import { DETAILS_MODES, DetailsMode } from '../engine/decision/extraction';
import { OBSERVER_SETTINGS, ObserverSetting } from '../engine/observer/settings';
import { decisionsOf } from './shared/callModel';
import { formatUsd } from './shared/cost';
import { supportEvals } from './evals/support';
import { debuggerUrl, runTextCall, TextCallResult } from './textCall';

// ----------------------------------------------------------------------------- //
// pnpm compare: runs the scripted test calls against the running agent (needs  //
// `pnpm dev`) for every combination of model, observer and details setting,    //
// and compares outcomes, latency and cost.                                      //
//   pnpm compare                                         # default model, no observer
//   pnpm compare --observers off,thread,dataconnection   # compare observers
//   pnpm compare --details agent,jev,extract             # compare how details are captured
//   pnpm compare --models default,ultravox-v0.7          # compare models
//   pnpm compare --runs 3 --concurrency 4                # repeat each case (LLM runs vary)
// Results are also written to devtools/results/compare-<time>.json.            //
// ----------------------------------------------------------------------------- //

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
};
/** A comma-separated flag; exits with the allowed values if one isn't. */
function list<T extends string>(name: string, allowed: readonly T[], fallback: T[]): T[] {
  const values = arg(name)?.split(',') ?? fallback;
  const bad = values.filter((value) => !allowed.includes(value as T));
  if (bad.length) {
    console.error(`Unknown ${name} value${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}. Use any of: ${allowed.join(', ')}.`);
    process.exit(1);
  }
  return values as T[];
}
function count(name: string, fallback: number): number {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} needs a whole number of at least 1.`);
    process.exit(1);
  }
  return value;
}
const runs = count('--runs', 1);
const models = arg('--models')?.split(',') ?? ['default'];
const observers = list<ObserverSetting>('--observers', OBSERVER_SETTINGS, ['off']);
const detailsModes = list<DetailsMode>('--details', DETAILS_MODES, ['agent']);
// Ultravox limits concurrent calls per account; keep this low.
const concurrency = count('--concurrency', 2);

interface Config {
  model: string;
  observer: ObserverSetting;
  details: DetailsMode;
}
const label = (config: Config) => `${config.model} · observer ${config.observer} · details ${config.details}`;
const configs: Config[] = models.flatMap((model) =>
  observers.flatMap((observer) => detailsModes.map((details) => ({ model, observer, details })))
);

interface Row extends Config {
  name: string;
  run: number;
  pass: boolean;
  reason?: string;
  callId?: string;
  result?: TextCallResult;
  error?: string;
}

async function runCase(config: Config, evalIndex: number, run: number): Promise<Row> {
  const evaluation = supportEvals[evalIndex];
  try {
    const result = await runTextCall({ ...config, lines: evaluation.lines });
    const failure = result.stuck ? 'the agent stopped replying' : evaluation.check(result);
    return { ...config, name: evaluation.name, run, pass: !failure, reason: failure, callId: result.callId, result };
  } catch (error) {
    return { ...config, name: evaluation.name, run, pass: false, error: String(error).slice(0, 200) };
  }
}

// A small pool, so calls run in parallel without hammering anything.
async function pool(tasks: (() => Promise<Row>)[], size: number): Promise<Row[]> {
  const results: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        const row = (results[index] = await tasks[index]());
        console.log(`${row.pass ? 'PASS' : 'FAIL'} [${label(row)}] ${row.name}${row.reason ? ` (${row.reason})` : ''}${row.error ? ` (error: ${row.error})` : ''}`);
      }
    })
  );
  return results;
}

const average = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
/** The average over all calls' items, from each call's [average, count]: a call with none doesn't count as 0. */
const pooled = (calls: [number, number][]) => {
  const total = calls.reduce((sum, [, n]) => sum + n, 0);
  return total ? calls.reduce((sum, [avg, n]) => sum + avg * n, 0) / total : 0;
};

const tasks = configs.flatMap((config) =>
  supportEvals.flatMap((_, index) => Array.from({ length: runs }, (_, run) => () => runCase(config, index, run)))
);
console.log(
  `Running ${tasks.length} calls (${supportEvals.length} cases × ${configs.length} configurations × ${runs} runs, ${concurrency} at a time)…\n`
);
const rows = await pool(tasks, concurrency);

// ---- Summary ----
console.log(
  '\n| Configuration | Passed | Avg agent response | Avg tool call | Jev checks/call | Observer acted/call | Observer delay | Side generations/call | Est. cost/call |'
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const config of configs) {
  const mine = rows.filter((row) => label(row) === label(config));
  const results = mine.flatMap((row) => (row.result ? [row.result] : []));
  const observerLogs = results.flatMap((r) => decisionsOf(r.stream).filter((log) => log.source === 'observer'));
  const delays = observerLogs.flatMap((log) => (log.observer?.delayMs !== undefined ? [log.observer.delayMs] : []));
  const acted = observerLogs.filter((log) => log.verdict === 'applied' || log.verdict === 'nudged');
  console.log(
    `| ${label(config)} | ${mine.filter((row) => row.pass).length}/${mine.length} ` +
      `| ${pooled(results.map((r) => [r.timings.averageResponseSeconds, r.timings.responses])).toFixed(2)} s ` +
      `| ${Math.round(pooled(results.map((r) => [r.timings.averageToolMs, r.timings.toolCalls])))} ms ` +
      `| ${average(results.map((r) => decisionsOf(r.stream).length)).toFixed(1)} ` +
      `| ${config.observer === 'off' ? '-' : (acted.length / Math.max(results.length, 1)).toFixed(1)} ` +
      `| ${delays.length ? `${(average(delays) / 1000).toFixed(1)} s` : '-'} ` +
      `| ${average(results.map((r) => r.stream.sideGenerations ?? 0)).toFixed(1)} ` +
      `| ${formatUsd(average(results.map((r) => r.cost?.totalUsd ?? 0)))} |`
  );
}

console.log('\n| Case | ' + configs.map(label).join(' | ') + ' |');
console.log('|---|' + configs.map(() => '---|').join(''));
for (const evaluation of supportEvals) {
  const cells = configs.map((config) => {
    const mine = rows.filter((row) => label(row) === label(config) && row.name === evaluation.name);
    const failures = mine.filter((row) => !row.pass).map((row) => row.reason ?? row.error);
    return `${mine.filter((row) => row.pass).length}/${mine.length}${failures.length ? ` (${failures.join('; ')})` : ''}`;
  });
  console.log(`| ${evaluation.name} | ${cells.join(' | ')} |`);
}

console.log('\nOpen any call in the debugger:');
for (const row of rows.filter((row) => row.callId)) console.log(`  [${label(row)}] ${row.name}: ${debuggerUrl(row.callId!)}`);

fs.mkdirSync('devtools/results', { recursive: true });
const file = `devtools/results/compare-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(
  file,
  JSON.stringify(
    rows.map(({ result, ...row }) => ({
      ...row,
      path: result?.path,
      finalState: result?.finalState,
      timings: result?.timings,
      cost: result?.cost,
      // The request text is long; the debugger link has it.
      decisions: result ? decisionsOf(result.stream).map((log) => ({ ...log, request: undefined })) : undefined,
    })),
    null,
    2
  )
);
console.log(`\nWrote ${file}`);
process.exit(0);
