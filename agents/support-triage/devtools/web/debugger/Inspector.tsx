import React, { useState } from 'react';
import { DecisionLog } from '../../../engine/decision/check';
import { stateGoal } from '../../../engine/prompt';
import { getAvailableActions } from '../../../engine/stateMachine';
import { AnyScenario, CallState } from '../../../engine/types';
import TestGuide from './TestGuide';
import { testGuide } from './guides';

type Tab = 'state' | 'guide' | 'data';

interface InspectorProps {
  scenario: AnyScenario;
  callState: CallState;
  /** The state to show; the current state unless one was clicked in the graph. */
  state: string;
  following: boolean;
  onFollowCurrent: () => void;
  decisions: DecisionLog[];
  /** Sends a line as the caller. Undefined when no call is active. */
  onSay?: (text: string) => void;
}

const TABS: Record<Tab, string> = { state: 'State', guide: 'What to say', data: 'Call data' };

/** Details for the selected state, the test guide, and the raw call data. */
const Inspector: React.FC<InspectorProps> = ({
  scenario,
  callState,
  state,
  following,
  onFollowCurrent,
  decisions,
  onSay,
}) => {
  const [tab, setTab] = useState<Tab>('state');
  const definition = scenario.states[state];
  // E.g. a call from another scenario: show what's known instead of crashing.
  if (!definition) {
    return (
      <div className="h-full bg-white rounded-lg border border-slate-200 shadow-sm p-3 text-sm text-slate-500">
        <span className="font-mono">{state}</span> isn't a state in {scenario.label}.{' '}
        {state !== callState.currentState && (
          <button className="text-xs text-indigo-600 underline" onClick={onFollowCurrent}>
            show current ({callState.currentState})
          </button>
        )}
      </div>
    );
  }
  const isCurrent = state === callState.currentState;
  const goal = stateGoal(scenario, { ...callState, currentState: state });
  const descriptions: Record<string, string> = scenario.prompts.actions;
  const actions = getAvailableActions(scenario, state);
  const checksHere = decisions.filter((log) => log.state === state);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-slate-200 shadow-sm min-h-0">
      <div className="flex border-b border-slate-200">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <button
            key={key}
            className={`px-3 py-2 text-sm ${tab === key ? 'border-b-2 border-indigo-500 text-indigo-700 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
            onClick={() => setTab(key)}
          >
            {TABS[key]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm min-h-0">
        {tab === 'state' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{state}</span>
              {isCurrent ? (
                <span className="text-xs px-1.5 rounded bg-blue-100 text-blue-800">current</span>
              ) : (
                <button className="text-xs text-indigo-600 underline" onClick={onFollowCurrent}>
                  show current ({callState.currentState})
                </button>
              )}
              {following && isCurrent && <span className="text-xs text-slate-400">follows the call</span>}
            </div>
            <div className="text-slate-600">{definition.description}</div>

            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Instruction the agent gets</div>
              <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded p-2 text-[11px]">{scenario.prompts.goal(goal)}</pre>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
                Actions
              </div>
              {actions.length === 0 && <div className="text-slate-400 italic">Terminal state</div>}
              <ul className="flex flex-col gap-1">
                {actions.map((action) => (
                  <li key={action} className="flex items-start gap-2">
                    <span className="shrink-0 font-mono text-xs">{action}</span>
                    <span className="text-xs text-slate-500">{descriptions[action]}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Jev checks in this state ({checksHere.length})</div>
              {checksHere.slice(-5).map((log, index) => (
                <div key={index} className="text-xs font-mono text-slate-600">
                  {log.source === 'updateState' ? `updateState ${log.proposed}` : log.source} → {log.verdict}
                  {log.winner ? ` (top: ${log.winner} ${Math.round((log.outcome?.[0]?.[1] ?? 0) * 100)}%)` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'guide' && (
          <TestGuide guide={testGuide} currentState={callState.currentState} onSay={onSay} />
        )}
        {tab === 'data' && (
          <pre className="whitespace-pre-wrap text-[11px] bg-slate-50 border border-slate-200 rounded p-2">
            {JSON.stringify(callState.callData, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

export default Inspector;
