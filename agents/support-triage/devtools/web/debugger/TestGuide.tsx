import React from 'react';
import { TestGuide as Guide } from './guides/types';

interface TestGuideProps {
  guide: Guide;
  currentState: string;
  /** Sends a line as the caller (text). Undefined when no call is active. */
  onSay?: (text: string) => void;
}

const Line: React.FC<{ text: string; onSay?: (text: string) => void }> = ({ text, onSay }) => (
  <li className="flex items-start gap-2 py-0.5">
    {onSay && (
      <button
        className="shrink-0 px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        title="Send this as the caller (text)"
        onClick={() => onSay(text)}
      >
        Send
      </button>
    )}
    <span className="text-slate-700">"{text}"</span>
  </li>
);

/** What to say when testing the agent: per-state examples, limits, and full test scripts. */
const TestGuide: React.FC<TestGuideProps> = ({ guide, currentState, onSay }) => {
  const hints = guide.stateHints[currentState] ?? [];

  return (
    <div className="text-left text-sm">
      <p className="text-slate-500 mb-4">
        Speak naturally; these are only examples. {onSay ? 'Send types a line as the caller, so you can test without talking.' : 'Start a call to send lines as text.'}
      </p>

      {hints.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="font-semibold text-blue-800 mb-1">
            Try now <span className="font-mono font-normal">({currentState})</span>
          </div>
          <ul>
            {hints.map((hint) => (
              <Line key={hint} text={hint} onSay={onSay} />
            ))}
          </ul>
        </div>
      )}

      {guide.sampleData && (
        <div className="mb-4">
          <div className="font-semibold text-slate-800 mb-1">{guide.sampleData.title}</div>
          <table className="w-full text-xs text-slate-700">
            <thead>
              <tr className="text-left border-b border-slate-300">
                {guide.sampleData.columns.map((column) => (
                  <th key={column} className="py-1 pr-3">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.sampleData.rows.map((row) => (
                <tr key={row.join('|')} className="border-b border-slate-200 font-mono">
                  {row.map((cell) => (
                    <td key={cell} className="py-1 pr-3">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 mb-4">
        <div>
          <div className="font-semibold text-green-800 mb-1">The agent handles</div>
          <ul className="list-disc list-inside text-slate-700 space-y-0.5">
            {guide.handles.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-semibold text-amber-800 mb-1">Limits and hand-offs</div>
          <ul className="list-disc list-inside text-slate-700 space-y-0.5">
            {guide.limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <details>
        <summary className="cursor-pointer font-semibold text-slate-800 select-none">
          Test calls ({guide.scripts.length}): say these in order and check the states
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {guide.scripts.map((script) => (
            <div key={script.title} className="p-3 bg-white border border-slate-200 rounded">
              <div className="font-semibold text-slate-800">{script.title}</div>
              <ol className="my-1">
                {script.lines.map((line) => (
                  <Line key={line} text={line} onSay={onSay} />
                ))}
              </ol>
              <div className="text-xs text-slate-500">
                Expect: <span className="font-mono">{script.expect}</span>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};

export default TestGuide;
