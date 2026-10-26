import React from 'react';
import { Transcript } from 'ultravox-client';
import { isInstruction } from '../../../engine/decision/check';

/** What a caller experiences: just the conversation, with no system messages or debugging. */
const CallerView: React.FC<{ transcript: Transcript[] }> = ({ transcript }) => {
  const lines = transcript.filter((line) => line.text.trim() && !isInstruction(line.text));
  return (
    <section className="flex-1 min-h-0 flex justify-center">
      <div className="w-full max-w-2xl flex flex-col bg-white rounded-lg border border-slate-200 shadow-sm">
        <div className="px-4 py-2 border-b border-slate-200 text-sm text-slate-500">
          Caller view: the conversation as the caller hears it. Switch to Developer view to see how the agent works.
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {lines.length === 0 && <div className="text-slate-400 italic text-center py-12">Start a call and say hello.</div>}
          {lines.map((line) => (
            <div
              key={line.ordinal}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                line.speaker === 'user' ? 'self-end bg-blue-600 text-white' : 'self-start bg-slate-100 text-slate-800'
              } ${line.isFinal ? '' : 'opacity-60'}`}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CallerView;
