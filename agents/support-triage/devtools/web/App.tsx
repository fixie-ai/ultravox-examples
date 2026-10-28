import { useState } from "react";
import { TextMessageUrgency, UltravoxSessionStatus } from "ultravox-client";
import { supportScenario as scenario } from "../../agent";
import { prompts } from "../../agent/prompts";
import { initializeStateMachine } from "../../engine/stateMachine";
import { MAIN_TOOL } from "../../engine/prompt";
import { decisionsOf, summarizePath } from "../shared/callModel";
import { useUltravoxSession } from "./hooks/useUltravoxSession";
import { useCallStream } from "./hooks/useCallStream";
import { useStoredState } from "./hooks/useStoredState";
import { NewCall, useCallSettings } from "./hooks/useCallSettings";
import CallControls from "./components/CallControls";
import CallStatus from "./components/CallStatus";
import CallerView from "./components/CallerView";
import CallSettingsPickers from "./components/CallSettingsPickers";
import CallTimeline from "./debugger/CallTimeline";
import LiveCost from "./debugger/LiveCost";
import StateGraph from "./debugger/StateGraph";
import Inspector from "./debugger/Inspector";

// ----------------------------------------------------------------------------- //
// The developer tools web app. The agent itself runs on Ultravox with HTTP      //
// tools (agent/); this app only:                                                //
//   - starts test calls from the saved Ultravox agent (through the devtools     //
//     server, which adds a data connection) and joins them for audio;          //
//   - shows what the data connection streams: turns, tool calls, Jev decisions, //
//     state changes, timing and cost.                                           //
// ----------------------------------------------------------------------------- //

const params = new URLSearchParams(window.location.search);
// The agent's tools, for the state graph.
const tools = [MAIN_TOOL, ...scenario.tools.map((tool) => tool.name)];
// ?callId=… opens an existing call (e.g. one started by pnpm text-call) in the debugger, read-only.
const viewCallId = params.get("callId") ?? undefined;

type View = "developer" | "caller";
const isView = (value: unknown): value is View => value === "developer" || value === "caller";

async function createCall({ model, observer, details }: NewCall): Promise<{ callId: string; joinUrl: string }> {
  const response = await fetch("/api/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, observer, details }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function App() {
  const [view, setView] = useStoredState("view", isView, "developer");
  const settings = useCallSettings();

  // ---- The call: audio in this tab, plus what the data connection tells us ----
  const [joinURL, setJoinURL] = useState<string | undefined>(undefined);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const { session, status, transcript } = useUltravoxSession(joinURL);
  const callActive = !!session && status !== UltravoxSessionStatus.IDLE && status !== UltravoxSessionStatus.DISCONNECTED;
  const [callId, setCallId] = useState<string | undefined>(viewCallId);
  const [selectedState, setSelectedState] = useState<string | undefined>(undefined);
  const viewOnly = !!viewCallId && callId === viewCallId;
  const stream = useCallStream(callId);

  // Starting a call. The previous call stays on screen until the new one exists, for review.
  const startNewCall = async () => {
    setIsStartingCall(true);
    try {
      const created = await createCall(settings);
      setSelectedState(undefined);
      setCallId(created.callId);
      setJoinURL(created.joinUrl);
    } catch (error) {
      console.error("Failed to start call:", error);
      alert(`Failed to start call: ${error}`);
    } finally {
      setIsStartingCall(false);
    }
  };

  // ---- Test controls (developer tools only) ----
  const wrapUp = () =>
    session?.sendText(prompts.devtools.wrapUp, {
      urgency: TextMessageUrgency.LATER,
    });
  const sayAsCaller = callActive && session ? (text: string) => session.sendText(text) : undefined;

  const call = stream.model;
  const machine = call.agentState?.machine ?? initializeStateMachine(scenario);
  const path = summarizePath(scenario.initialState, call.events);
  const decisions = decisionsOf(call);
  const streamHint =
    stream.status !== "closed" || !callId
      ? undefined
      : viewOnly && !stream.opened
        ? "This devtools server doesn't know that call (it keeps calls in memory)."
        : callActive || (viewOnly && stream.endedAt === undefined)
          ? "Lost the devtools server's event stream: the timeline isn't updating."
          : undefined;

  return (
    <div className="flex flex-col h-screen p-3 gap-3 text-left">
      {/* The agent: what a real product would have. */}
      <header className="flex flex-wrap items-center gap-4 bg-white rounded-lg border border-slate-200 shadow-sm px-4 py-2">
        <div className="mr-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">Agent</span>
            <h1 className="text-lg font-semibold text-slate-800">{scenario.label}</h1>
          </div>
          <p className="text-xs text-slate-500">Ultravox agent with HTTP tools: {tools.join(", ")}</p>
        </div>
        <CallStatus status={status} />
        <CallControls callActive={callActive} isStartingCall={isStartingCall} onStartCall={startNewCall} onEndCall={() => setJoinURL(undefined)} />
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs">
          {(["developer", "caller"] as View[]).map((option) => (
            <button
              key={option}
              className={`px-2.5 py-1.5 ${view === option ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              onClick={() => setView(option)}
            >
              {option === "developer" ? "Developer view" : "Caller view"}
            </button>
          ))}
        </div>
      </header>

      {view === "caller" ? (
        <CallerView transcript={transcript} />
      ) : (
        /* Developer tools: observe the agent; not part of it. */
        <section className="flex-1 flex flex-col min-h-0 rounded-lg border-2 border-slate-700 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-slate-100 px-3 py-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wider">Developer tools</span>
            <span className="text-slate-400 hidden 2xl:inline">observe the agent and test it; not part of the agent</span>
            <span className="text-slate-400">Next call:</span>
            <CallSettingsPickers settings={settings} disabled={callActive || isStartingCall} />
            {call.setup && (
              <span className="text-slate-400">
                · this call:{" "}
                <span className="text-slate-200">
                  {call.setup.model} · observer {call.setup.observer} · details {call.setup.details}
                </span>
              </span>
            )}
            {streamHint && <span className="text-amber-300">{streamHint}</span>}
            <span className="ml-auto" />
            <LiveCost
              callId={callId}
              callActive={callActive}
              viewOnly={viewOnly}
              streamEndedAt={stream.endedAt}
              decisions={decisions}
              sideGenerations={call.sideGenerations ?? 0}
            />
            <button
              className="px-2 py-0.5 rounded bg-amber-400 text-amber-950 disabled:opacity-40"
              disabled={!callActive}
              onClick={wrapUp}
              title="Test control: tells the agent to wrap up"
            >
              Wrap up
            </button>
          </div>
          {/* The row and columns are sized by the window, not by their content: the timeline scrolls inside
              its pane instead of growing the page. */}
          <main className="flex-1 grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 p-3 bg-slate-100 min-h-0 overflow-hidden">
            <CallTimeline events={call.events} version={stream.version} onSend={sayAsCaller} />
            <div className="flex flex-col gap-3 min-h-0 h-full">
              <div className="flex-[3] min-h-[240px] bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <StateGraph
                  scenario={scenario}
                  currentState={machine.currentState}
                  path={path}
                  selectedState={selectedState}
                  onSelect={setSelectedState}
                />
              </div>
              <div className="flex-[2] min-h-[200px]">
                <Inspector
                  scenario={scenario}
                  callState={machine}
                  state={selectedState ?? machine.currentState}
                  following={!selectedState}
                  onFollowCurrent={() => setSelectedState(undefined)}
                  decisions={decisions}
                  onSay={sayAsCaller}
                />
              </div>
            </div>
          </main>
        </section>
      )}
    </div>
  );
}

export default App;
