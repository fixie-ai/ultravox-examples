import { buildSystemPrompt, actionDescriptions, MAIN_TOOL } from './prompt';
import { getAllActions } from './stateMachine';
import { AnyScenario, ToolParameter } from './types';

// ----------------------------------------------------------------------------- //
// The scenario as Ultravox HTTP tools and a call template (saved as an agent).  //
// The text (tool and parameter descriptions, the system prompt) comes from the  //
// scenario's prompts; the Ultravox settings from its `ultravox` settings.        //
// ----------------------------------------------------------------------------- //

/** Where the tools are served. */
export interface ToolServer {
  /** Public base URL of the HTTP tool server, e.g. https://tools.example.com */
  baseUrl: string;
  /**
   * Shared secret the tool server checks (TOOLS_SECRET). Ultravox sends it in TOOL_SECRET_HEADER on every tool
   * call, so only your agent's calls can use the tools. The model never sees it.
   */
  secret?: string;
}

export const TOOL_SECRET_HEADER = 'X-Tool-Secret';

/** Internal tools, called only from side threads; the tool server refuses them from the main conversation. */
export const OBSERVER_TOOL = 'observeTurn';
export const RECORD_DETAILS_TOOL = 'recordDetails';

// Every HTTP tool gets the call state (where the state machine lives), the
// conversation (for the decision model) and the call id.
const AUTOMATIC_PARAMETERS = [
  { name: 'callState', location: 'PARAMETER_LOCATION_BODY', knownValue: 'KNOWN_PARAM_CALL_STATE' },
  { name: 'conversation', location: 'PARAMETER_LOCATION_BODY', knownValue: 'KNOWN_PARAM_CONVERSATION_HISTORY' },
  { name: 'callId', location: 'PARAMETER_LOCATION_BODY', knownValue: 'KNOWN_PARAM_CALL_ID' },
  // Per-call settings (e.g. the details mode) are passed as call metadata.
  { name: 'callMetadata', location: 'PARAMETER_LOCATION_BODY', knownValue: 'KNOWN_PARAM_CALL_METADATA' },
];

/** A tool on the tool server, with its description and parameter descriptions from the prompts. */
function httpTool<E extends Record<string, unknown>>(scenario: AnyScenario, server: ToolServer, name: string, parameters: ToolParameter[], extra: E = {} as E) {
  const text = scenario.prompts.tools[name] ?? { description: '' };
  return {
    temporaryTool: {
      modelToolName: name,
      description: text.description,
      dynamicParameters: parameters.map(({ name: param, schema, required }) => {
        const description = text.params?.[param];
        return { name: param, location: 'PARAMETER_LOCATION_BODY', schema: description ? { ...schema, description } : schema, required };
      }),
      ...extra,
      http: { baseUrlPattern: `${server.baseUrl.replace(/\/$/, '')}/tools/${name}`, httpMethod: 'POST' },
      automaticParameters: AUTOMATIC_PARAMETERS,
      // The tool server's secret, as a header (only when one is set). The model never sees it.
      staticParameters: server.secret ? [{ name: TOOL_SECRET_HEADER, location: 'PARAMETER_LOCATION_HEADER', value: server.secret }] : [],
    },
  };
}

/** The state machine's tool (updateState), as an HTTP tool. Its action list is generated from the states. */
export function buildMainTool(scenario: AnyScenario, server: ToolServer) {
  const text = scenario.prompts.updateState;
  return httpTool(scenario, server, MAIN_TOOL, [
    { name: 'action', schema: { type: 'string', enum: getAllActions(scenario), description: text.action({ actions: actionDescriptions(scenario) }) }, required: true },
    { name: 'additionalData', schema: { type: 'object', description: text.additionalData({ keys: scenario.modelWritableKeys }), additionalProperties: true } },
  ], {
    description: text.description,
    // Speak after the result (it carries the next goal) only if the agent didn't speak right before the call.
    // A model that replies first and then calls updateState has often asked the next question already; making it
    // speak again repeated that question (about 1.5 times a call with some models, against none like this).
    defaultReaction: 'AGENT_REACTION_SPEAKS_ONCE',
  });
}

/**
 * An internal tool. It's on the agent so a side thread (which inherits the agent's tools) can call it, and it
 * gets the caller's thread id (KNOWN_PARAM_THREAD_ID) so the tool server can refuse calls from the main
 * conversation.
 */
function internalTool(scenario: AnyScenario, server: ToolServer, name: string, parameters: ToolParameter[]) {
  const tool = httpTool(scenario, server, name, parameters);
  tool.temporaryTool.automaticParameters = [
    ...AUTOMATIC_PARAMETERS,
    { name: 'threadId', location: 'PARAMETER_LOCATION_BODY', knownValue: 'KNOWN_PARAM_THREAD_ID' },
  ];
  return tool;
}

/** The observer's tool (thread variant). */
export const buildObserverTool = (scenario: AnyScenario, server: ToolServer) =>
  internalTool(scenario, server, OBSERVER_TOOL, [{ name: 'turnAt', schema: { type: 'number' } }]);

/** The extraction thread's tool ("extract" details mode). */
export const buildRecordDetailsTool = (scenario: AnyScenario, server: ToolServer) =>
  internalTool(scenario, server, RECORD_DETAILS_TOOL, [{ name: 'details', schema: { type: 'object', additionalProperties: true }, required: true }]);

/**
 * The Ultravox call template for this scenario: what you save as an Ultravox agent (POST /api/agents). Every tool
 * is an HTTP tool on your tool server, and the state machine lives in the call's state. The first goal is in the
 * system prompt (so every call has it, however it's created), and the tool server starts the state machine on the
 * first tool call. `model` overrides the scenario's Ultravox model.
 */
export function buildCallTemplate(scenario: AnyScenario, server: ToolServer, options: { model?: string } = {}) {
  const { voice, firstSpeaker, model, builtInTools, callTemplate } = scenario.ultravox;
  const chosenModel = options.model ?? model;
  return {
    ...callTemplate,
    ...(chosenModel ? { model: chosenModel } : {}),
    systemPrompt: buildSystemPrompt(scenario),
    voice,
    firstSpeakerSettings: firstSpeaker === 'agent' ? { agent: {} } : { user: {} },
    selectedTools: [
      ...builtInTools,
      buildMainTool(scenario, server),
      ...scenario.tools.map((tool) => httpTool(scenario, server, tool.name, tool.parameters ?? [])),
      buildObserverTool(scenario, server),
      ...(scenario.extraction ? [buildRecordDetailsTool(scenario, server)] : []),
    ],
  };
}
