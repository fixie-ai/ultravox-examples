import React, { useEffect, useRef, useState } from 'react';
import { DecisionLog } from '../../../engine/decision/check';
import { observerVariantLabel, TimelineEvent } from '../../shared/callModel';

// One scrolling timeline for the whole call: turns, instructions, tool calls,
// transitions, decision checks and thread events, in order.

type Filter = 'tools' | 'decisions' | 'transitions' | 'timing' | 'instructions' | 'threads';

const FILTER_LABELS: Record<Filter, string> = {
  decisions: 'Jev checks',
  transitions: 'Transitions',
  tools: 'Tool calls',
  timing: 'Response timing',
  instructions: 'Instructions',
  threads: 'Thread events',
};

const VERDICT_STYLES: Record<DecisionLog['verdict'], string> = {
  accepted: 'bg-green-100 text-green-800',
  applied: 'bg-green-100 text-green-800',
  overridden: 'bg-amber-100 text-amber-800',
  nudged: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
  fail_open: 'bg-slate-200 text-slate-800',
  skipped: 'bg-slate-100 text-slate-500',
  no_change: 'bg-slate-100 text-slate-500',
};

const VERDICT_HELP: Record<DecisionLog['verdict'], string> = {
  accepted: 'Applied the agent’s action',
  applied: 'Jev picked this action and it was applied',
  overridden: 'Rejected: the caller seems to mean something else',
  nudged: 'No transition; the agent got a note',
  rejected: 'Not applied (needs clarification or more information)',
  failed: 'Decision model call failed',
  fail_open: 'Decision model failed or was slow; continued without it',
  skipped: 'No check needed (tool-backed or invalid action)',
  no_change: 'The goal isn’t met yet; stayed in this state',
};

const percent = (p: number) => `${Math.round(p * 100)}%`;
const time = (at: number, start: number) => `${((at - start) / 1000).toFixed(1)}s`;

const Bar: React.FC<{ label: string; p: number; highlight: 'proposed' | 'winner' | 'both' | null }> = ({ label, p, highlight }) => (
  <div className="flex items-center gap-2 text-[11px] font-mono">
    <span className={`w-36 truncate ${highlight ? 'font-semibold' : ''}`} title={label}>
      {label}
      {highlight === 'proposed' || highlight === 'both' ? ' ◂' : ''}
    </span>
    <div className="flex-1 h-2 bg-slate-200 rounded">
      <div
        className={`h-2 rounded ${highlight === 'both' || highlight === 'winner' ? 'bg-indigo-500' : highlight === 'proposed' ? 'bg-amber-500' : 'bg-slate-400'}`}
        style={{ width: percent(p) }}
      />
    </div>
    <span className="w-9 text-right">{percent(p)}</span>
  </div>
);

const DecisionCard: React.FC<{ log: DecisionLog }> = ({ log }) => {
  // updateState: the agent proposed an action and Jev checked it. The observer: Jev chose.
  const decided = log.source !== 'updateState';
  const title =
    log.source === 'extract'
      ? 'Extraction thread (LLM)'
      : log.source === 'observer'
        ? `Jev · observer (${observerVariantLabel(log.observer?.variant)})`
        : 'Jev · updateState check (agent proposed)';
  return (
    <div className={`rounded-md border p-2 text-xs ${decided ? 'border-violet-200 bg-violet-50/50' : 'border-indigo-200 bg-indigo-50/50'}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`font-semibold ${decided ? 'text-violet-800' : 'text-indigo-800'}`}>
          {title}
        </span>
        <span className="font-mono text-slate-600">in {log.state}</span>
        {!decided && (
          <span className="font-mono">
            proposed <strong>{log.proposed}</strong>
          </span>
        )}
        <span className={`px-1.5 rounded ${VERDICT_STYLES[log.verdict]}`} title={VERDICT_HELP[log.verdict]}>
          {log.verdict}
        </span>
        <span className="text-slate-500 ml-auto">
          {log.latencyMs} ms{log.provider ? ` · ${log.provider}` : ''}
          {log.observer?.delayMs !== undefined ? ` · took effect ${(log.observer.delayMs / 1000).toFixed(1)} s after the caller's turn` : ''}
        </span>
      </div>
      {log.outcome && (
        <div className="flex flex-col gap-0.5 my-1">
          {log.outcome.map(([option, p]) => (
            <Bar
              key={option}
              label={option}
              p={p}
              highlight={
                option === log.proposed && option === log.winner
                  ? 'both'
                  : option === log.proposed
                    ? 'proposed'
                    : option === log.winner
                      ? 'winner'
                      : null
              }
            />
          ))}
        </div>
      )}
      {log.extras && Object.keys(log.extras).length > 0 && (
        <div className="flex flex-wrap gap-1 my-1">
          {Object.entries(log.extras).map(([id, [best, p]]) => (
            <span key={id} className="px-1.5 rounded bg-white border border-slate-200 font-mono text-[11px]">
              {id}: {best} {percent(p)}
            </span>
          ))}
        </div>
      )}
      {log.note && <div className="text-slate-600">Note: {log.note}</div>}
      {log.error && <div className="text-red-600">{log.error}</div>}
      {log.request && (
        <details className="mt-1">
          <summary className="cursor-pointer text-slate-500 select-none">What Jev was asked</summary>
          <pre className="whitespace-pre-wrap bg-white border border-slate-200 rounded p-2 mt-1 text-[11px]">{log.request.context}</pre>
          <ul className="mt-1 text-[11px]">
            {log.request.questions.map((question) => (
              <li key={question.id} className="mb-1">
                <span className="font-mono font-semibold">{question.id}</span>: {question.prompt}
                <div className="font-mono text-slate-500">{question.options.join(' | ')}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

const EventRow: React.FC<{ event: TimelineEvent; start: number }> = ({ event, start }) => {
  const stamp = <span className="w-12 shrink-0 text-[10px] text-slate-400 font-mono pt-1">{time(event.at, start)}</span>;
  switch (event.kind) {
    case 'turn':
      return (
        <div className={`flex gap-2 ${event.speaker === 'caller' ? 'flex-row-reverse' : ''}`}>
          {stamp}
          <div
            className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm whitespace-pre-wrap ${
              event.speaker === 'caller' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200'
            } ${event.final ? '' : 'opacity-60 italic'}`}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-70">{event.speaker === 'caller' ? 'Caller' : 'Agent'}</div>
            {event.text.trim()}
          </div>
        </div>
      );
    case 'instruction':
      return (
        <div className="flex gap-2">
          {stamp}
          <details className="flex-1 text-xs text-slate-500">
            <summary className="cursor-pointer select-none">System instruction sent to the agent</summary>
            <pre className="whitespace-pre-wrap bg-slate-100 rounded p-2 mt-1 text-[11px]">{event.text}</pre>
          </details>
        </div>
      );
    case 'tool':
      return (
        <div className="flex gap-2">
          {stamp}
          <details className="flex-1 text-xs">
            <summary className="cursor-pointer select-none font-mono text-slate-600">
              <span className="px-1 rounded bg-slate-200 text-slate-700 mr-1">HTTP tool</span>
              {event.threadId !== 'UI' && <span className="px-1 rounded bg-violet-100 text-violet-700 mr-1">thread {event.threadId}</span>}
              {event.name}({Object.keys(event.params).join(', ')}){event.ms !== undefined ? ` · ${event.ms} ms` : ''}
              {event.error ? ` · error: ${event.error}` : ''}
            </summary>
            <pre className="whitespace-pre-wrap bg-slate-100 rounded p-2 mt-1 text-[11px]">
              {JSON.stringify(event.params, null, 2)}
              {'\n→ '}
              {event.result}
            </pre>
          </details>
        </div>
      );
    case 'transition':
      return (
        <div className="flex gap-2">
          {stamp}
          <div className="flex-1 text-xs rounded border border-green-200 bg-green-50 px-2 py-1">
            <span className="font-semibold text-green-800">
              State change · by {event.by}
            </span>
            {event.steps.map((step, index: number) => (
              <div key={index} className="font-mono text-green-900">
                {step.from} —{step.action}→ {step.to}
                {step.automatic && <span className="ml-1 text-green-700 italic">(auto-advance: nothing left to do)</span>}
              </div>
            ))}
          </div>
        </div>
      );
    case 'decision':
      return (
        <div className="flex gap-2">
          {stamp}
          <div className="flex-1">
            <DecisionCard log={event.log} />
          </div>
        </div>
      );
    case 'thread':
      return (
        <div className="flex gap-2">
          {stamp}
          <div className="flex-1 text-[11px] font-mono text-violet-600">
            thread {event.type.replace('thread_', '')}: {event.threadId}
            {event.reason ? ` (${event.reason})` : ''}
          </div>
        </div>
      );
    case 'response':
      return (
        <div className="flex gap-2">
          {stamp}
          <div className="flex-1 text-[11px] font-mono text-slate-500" title={event.delays.map((d) => `${d.phase}: ${d.seconds.toFixed(3)} s`).join('\n')}>
            agent responded in {event.seconds.toFixed(2)} s ({event.result.replace('_', ' ')})
            {event.delays.length > 0 && ` · ${event.delays.map((d) => `${d.phase.replace(/_/g, ' ')} ${d.seconds.toFixed(2)}s`).join(' · ')}`}
          </div>
        </div>
      );
  }
};

const visibleFor = (event: TimelineEvent, filters: Record<Filter, boolean>) => {
  switch (event.kind) {
    case 'turn':
      return true;
    case 'instruction':
      return filters.instructions;
    case 'tool':
      return filters.tools;
    case 'transition':
      return filters.transitions;
    case 'decision':
      return filters.decisions;
    case 'thread':
      return filters.threads;
    case 'response':
      return filters.timing;
  }
};

interface CallTimelineProps {
  events: TimelineEvent[];
  /** Changes whenever the events do (they're updated in place). */
  version: number;
  /** Sends text as the caller. Undefined when no call is active. */
  onSend?: (text: string) => void;
}

const CallTimeline: React.FC<CallTimelineProps> = ({ events, version, onSend }) => {
  const [filters, setFilters] = useState<Record<Filter, boolean>>({
    decisions: true,
    transitions: true,
    tools: true,
    timing: true,
    instructions: false,
    threads: false,
  });
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const visible = events.filter((event) => visibleFor(event, filters));
  const start = events[0]?.at ?? 0;

  // Follow new events while the view is scrolled to the bottom. Checked on scroll, before new rows render, so a
  // tall new row doesn't stop the following.
  const stickToBottom = useRef(true);
  const onScroll = () => {
    const element = scroller.current;
    if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  };
  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [visible.length, version]);

  const send = () => {
    if (onSend && text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-200">
        <h2 className="font-semibold text-slate-800 mr-auto">Call timeline</h2>
        {(Object.keys(FILTER_LABELS) as Filter[]).map((filter) => (
          <label key={filter} className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filters[filter]}
              onChange={(e) => setFilters({ ...filters, [filter]: e.target.checked })}
            />
            {FILTER_LABELS[filter]}
          </label>
        ))}
      </div>
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {visible.length === 0 && (
          <div className="text-slate-400 text-center italic py-12">Start a call. Turns, tool calls and Jev checks appear here.</div>
        )}
        {/* callModel updates events in place (tool latency, observer delay): EventRow can't be React.memo'd as is. */}
        {visible.map((event) => (
          <EventRow key={event.id} event={event} start={start} />
        ))}
      </div>
      <div className="flex gap-2 p-2 border-t border-slate-200">
        <input
          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
          placeholder={onSend ? 'Type as the caller…' : 'Start a call to type as the caller'}
          value={text}
          disabled={!onSend}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white disabled:bg-slate-300"
          disabled={!onSend || !text.trim()}
          onClick={send}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default CallTimeline;
