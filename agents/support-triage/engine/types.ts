import type { DecisionQuestion, DecisionResult } from './decision/types';

// ----------------------------------------------------------------------------- //
// Scenario types                                                                //
// ----------------------------------------------------------------------------- //
// A scenario is everything specific to one agent: its prompts, states, tools,   //
// sample data and Ultravox settings. The agent in agent/ is one; the engine     //
// runs it without knowing anything about support calls.                         //
// ----------------------------------------------------------------------------- //

/** Data collected during the call. The engine owns `stateHistory`. */
export interface CallData {
  stateHistory?: string[];
  [key: string]: unknown;
}

export interface CallState<S extends string = string> {
  currentState: S;
  previousState: S | null;
  callData: CallData;
}

/**
 * What the agent should accomplish in a state, written as a goal rather than a
 * script. Rendered as "Goal / Must include / Don't / When done" for the model.
 */
export interface GoalInstruction {
  goal: string;
  /** Facts the agent is required to say, e.g. the ticket number. */
  mustInclude?: string[];
  /** Things to avoid in this state. Re-asking and reading from a script are always added. */
  dont?: string[];
  /** Which action to take and what data it needs. */
  whenDone?: string[];
}

export interface TemplateInput<S extends string, Ctx> {
  context: Ctx;
  callData: CallData;
  previousState: S | null;
}

export interface StateAction<S extends string, Ctx> {
  nextState: S;
  /** Return true to allow the transition, or false / a reason string (shown to the model) to block it. */
  condition?: (callData: CallData, context: Ctx) => boolean | string;
  /** Changes to call data applied when the transition happens. */
  updateData?: (callData: CallData, context: Ctx) => Partial<CallData>;
  /**
   * Set to false for actions that depend on tool results rather than on what the
   * caller said (e.g. "the lookup found the account"). The decision model judges
   * the conversation, so it can't confirm these; the condition does instead.
   */
  decisionCheck?: boolean;
}

export interface StateDefinition<S extends string, A extends string, Ctx> {
  /** A short name for the state, for the debugger. (What the agent reads is in the prompts.) */
  description: string;
  /** Actions valid in this state. A state with no actions is terminal. */
  actions: Partial<Record<A, StateAction<S, Ctx>>>;
  /**
   * Runs when the call enters this state, and again whenever a tool or the agent adds call data while it's here.
   * Return an action to take it right away, so a caller who already answered this state's question never hears
   * it again. (Not run for the initial state when the call starts: there's no call data yet.)
   */
  autoAdvance?: (callData: CallData, context: Ctx) => A | undefined;
  /**
   * Runs when a transition enters this state (before autoAdvance). Returns call data to merge, e.g. the result of
   * a lookup the server should always do here rather than relying on the agent to call a tool.
   */
  enter?: (callData: CallData, context: Ctx) => Partial<CallData>;
}

/** What a scenario tool returns: text for the model, plus optional call data to merge. */
export interface ToolRunResult {
  result: string;
  callData?: Partial<CallData>;
}

/** One of a tool's parameters. Its description (what the model reads) is in the prompts. */
export interface ToolParameter {
  name: string;
  schema: Record<string, unknown>;
  required?: boolean;
}

export interface ScenarioTool<Ctx> {
  /** Name the model calls, i.e. the Ultravox `modelToolName`. Its description is in the prompts. */
  name: string;
  /** The parameters the model fills in. */
  parameters?: ToolParameter[];
  run: (
    params: Record<string, unknown>,
    input: { callData: CallData; context: Ctx }
  ) => ToolRunResult | Promise<ToolRunResult>;
}

export interface Scenario<S extends string = string, A extends string = string, Ctx = unknown> {
  id: string;
  /** Shown in the UI header. */
  label: string;
  /** Sample data (company, agent name, ...), passed to the prompts. */
  context: Ctx;
  /** Every word the models in a call read. */
  prompts: ScenarioPrompts<S, A, Ctx>;
  /** How the agent is set up on Ultravox: voice, who speaks first, built-in tools, ... */
  ultravox: UltravoxSettings;
  initialState: S;
  states: Record<S, StateDefinition<S, A, Ctx>>;
  /** Actions valid from every state except terminal ones, e.g. asking for a person. */
  globalActions?: Partial<Record<A, StateAction<S, Ctx>>>;
  /**
   * The `additionalData` keys the model may set with `updateState`. Everything
   * else is dropped. Object values are merged into the existing value.
   */
  modelWritableKeys: string[];
  tools: ScenarioTool<Ctx>[];
  /**
   * Where the caller's free-text answers are captured (e.g. "when did it start?"), for the details modes:
   * "jev" asks the decision model whether each field was answered; "extract" has a side thread pull them out.
   */
  extraction?: {
    states: S[];
    /** The fact key the fields are stored under, e.g. "details". */
    factKey: string;
    /** The fields still needed, keyed by name, with a description of each. */
    missing: (callData: CallData) => Record<string, string>;
  };
  /**
   * Extra questions for the decision model in `state`, asked alongside the
   * engine's "outcome" question on every updateState call.
   */
  decisionQuestions?: (state: S, callData: CallData, context: Ctx) => DecisionQuestion[];
  /**
   * Turns confident decision answers into call data (e.g. the category) and
   * notes for the agent. Runs on every check; `accepted` says whether the
   * proposed action passed.
   */
  applyDecision?: (input: {
    state: S;
    proposedAction: string;
    accepted: boolean;
    answers: DecisionResult;
    callData: CallData;
    acceptThreshold: number;
    /** The caller's most recent words, for filling fields from what they said. */
    lastCallerText?: string;
  }) => DecisionEffects;
}

/** What a scenario's applyDecision returns. */
export interface DecisionEffects {
  /** Call data set from the decision answers. Overrides the model's additionalData. */
  callData?: Partial<CallData>;
  /** Added to the agent's next instruction. */
  note?: string;
  /** Blocks an otherwise-accepted action, with the reason for the agent. */
  veto?: string;
}

// The engine works with any scenario, so it uses this widened type. (`any`, not
// `string`, because a scenario's callbacks take its own narrower state names.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScenario = Scenario<any, any, any>;

/** How the agent is set up on Ultravox. Your tools and the state machine's are added to `builtInTools`. */
export interface UltravoxSettings {
  voice: string;
  /** Maps to Ultravox `firstSpeakerSettings`. */
  firstSpeaker: 'agent' | 'user';
  /** The Ultravox model. Leave it out for Ultravox's default. */
  model?: string;
  /** Ultravox's built-in tools to add, e.g. `{ toolName: 'hangUp' }` or `queryCorpus` with a corpus. */
  builtInTools: Record<string, unknown>[];
  /** Any other Ultravox call template settings (languageHint, inactivityMessages, ...). */
  callTemplate?: Record<string, unknown>;
}

/** What the system prompt is built from. The action lists are generated from the states. */
export interface SystemPromptInput<S extends string, A extends string, Ctx> {
  context: Ctx;
  /** Each non-terminal state with its own actions and what they mean. */
  actionsByState: { state: S; actions: { action: A; description: string }[] }[];
  /** Actions valid in every state except `except`. */
  globalActions: { actions: { action: A; description: string }[]; except: S[] };
  /** The first state's instruction, so every call starts with its goal. */
  firstInstruction: string;
}

/** A piece of text that may take values (e.g. the action the agent proposed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Text = string | ((input: any) => string);

/**
 * Every word the models in a call read: the agent (system prompt, state instructions, feedback, tool descriptions),
 * the decision model (its questions and context) and the extraction thread. The engine reads these; your agent's
 * own code (conditions, tools, decisions) reads its parts (`conditions`, `notes`, `questions`, `toolResults`).
 */
export interface ScenarioPrompts<S extends string, A extends string, Ctx> {
  /** The system prompt, saved in the Ultravox agent. */
  systemPrompt: (input: SystemPromptInput<S, A, Ctx>) => string;
  /** Each state's goal. */
  states: Record<S, (input: TemplateInput<S, Ctx>) => GoalInstruction>;
  /** What each action means: shown to the agent in its action lists and to the decision model as options. */
  actions: Record<A, string>;
  /** A state's goal as it's written in the instruction (and in what the decision model judges). */
  goal: (goal: GoalInstruction) => string;
  /** The instruction the agent gets as the result of the tool call that enters a state. */
  instruction: (input: { state: S; note?: string; goal: string; validActions?: A[]; afterToolCall: boolean }) => string;

  /** What the agent is told when something happens (a rejected action, a skipped state, ...). */
  feedback: {
    notApplied: {
      callerQuestion: (input: { proposed: string }) => string;
      notYet: string;
      offTopic: string;
      optOut: string;
      meansOther: (input: { proposed: string; winner: string; description: string }) => string;
      vetoed: (input: { reason: string }) => string;
      notConfirmed: string;
    };
    wrapUp: string;
    rejected: (input: { reason: string }) => string;
    notYet: (input: { reason: string }) => string;
    invalidAction: (input: { action: string; state: S; valid: string[] }) => string;
    conditionNotMet: (input: { action: string; state: S }) => string;
    actionRequired: string;
    updateFailed: (input: { state: S; valid: string[] }) => string;
    skipped: (input: { states: S[] }) => string;
    observerMetGoal: string;
    answersRecorded: string;
    alreadyHandled: string;
    invalidMarker: string;
    toolFailed: (input: { tool: string }) => string;
    internalTool: string;
    notConfigured: (input: { what: string }) => string;
    nothingNew: string;
    sentToMainConversation: (input: { what: string }) => string;
    badRequest: string;
  };

  /** Tool descriptions: what the model reads to decide how to call each tool, keyed by tool name. */
  tools: Record<string, { description: string; params?: Record<string, string> }>;
  /** The state machine's tool. `actions` and `keys` are generated. */
  updateState: {
    description: string;
    action: (input: { actions: { action: A; description: string }[] }) => string;
    additionalData: (input: { keys: string[] }) => string;
  };

  /** The decision model's outcome question, its context, and (in "jev" details mode) its per-field questions. */
  decisionModel: {
    outcome: (input: { state: S }) => string;
    /** The outcomes that aren't actions, offered in every state. */
    outcomeOptions: { not_yet: string; caller_question: string; off_topic: string; opt_out: string };
    context: (input: { state: S; goal: string; facts: Record<string, unknown>; conversation: { speaker: 'caller' | 'agent'; text: string }[] }) => string;
    field: (input: { description: string }) => string;
    fieldOptions: { yes: string; no: string };
  };
  /** The extraction thread's prompt ("extract" details mode). */
  extraction: (input: { fields: { field: string; description: string }[] }) => string;

  /** Text your own code uses: descriptions of your values, the reasons conditions give, notes, questions, tool results. */
  descriptions?: Record<string, Record<string, string>>;
  conditions?: Record<string, Text>;
  notes?: Record<string, Text>;
  questions?: Record<string, { prompt: string; options: Record<string, string> }>;
  toolResults?: Record<string, Text>;
  /** Text the developer tools send (e.g. the debugger's Wrap up button). */
  devtools?: Record<string, Text>;
}
