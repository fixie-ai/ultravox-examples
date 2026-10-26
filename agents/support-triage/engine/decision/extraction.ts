import { mergeOverrides } from '../updateState';
import { AnyScenario, CallData, CallState, DecisionEffects } from '../types';
import { DecisionQuestion, DecisionResult } from './types';

// ----------------------------------------------------------------------------- //
// Capturing the caller's free-text answers (e.g. "when did it start?")          //
// ----------------------------------------------------------------------------- //
// The agent is supposed to pass them in its tool call, and sometimes doesn't.   //
// Two ways to catch them, so they can be compared ("details" mode, per call):  //
//   "agent":   only what the agent passes (the baseline).                       //
//   "jev":     each decision check also asks, per missing field, "did the       //
//              caller just say this?" A confident yes fills the field with the  //
//              caller's latest words. No extra LLM calls.                        //
//   "extract": after each caller turn, a side thread (a real LLM generation)    //
//              pulls the fields out and sends them in (toolServer, devtools). //
// ----------------------------------------------------------------------------- //

export type DetailsMode = 'agent' | 'jev' | 'extract';
export const DETAILS_MODES: DetailsMode[] = ['agent', 'jev', 'extract'];

export const isDetailsMode = (value: unknown): value is DetailsMode => DETAILS_MODES.includes(value as DetailsMode);

const FIELD_PREFIX = 'field:';

/** The fields still needed in this state, if the scenario captures any here. */
export function missingFieldsFor(scenario: AnyScenario, callState: CallState): Record<string, string> {
  const extraction = scenario.extraction;
  if (!extraction || !extraction.states.includes(callState.currentState)) return {};
  return extraction.missing(callState.callData);
}

/**
 * "jev" mode: one yes/no question per missing field. It asks about the caller's latest turn, because that's the
 * text a yes fills the field with.
 */
export function extractionQuestions(scenario: AnyScenario, callState: CallState, mode: DetailsMode | undefined): DecisionQuestion[] {
  if (mode !== 'jev') return [];
  const { field: prompt, fieldOptions } = scenario.prompts.decisionModel;
  return Object.entries(missingFieldsFor(scenario, callState)).map(([field, description]) => ({
    id: `${FIELD_PREFIX}${field}`,
    prompt: prompt({ description }),
    options: ['yes', 'no'],
    optionDescriptions: fieldOptions,
  }));
}

/**
 * "jev" mode: the fields the decision model is confident the caller just answered, filled with the caller's words.
 * Only the new fields, so merging them (mergeOverrides) keeps what's already there.
 */
export function extractionEffects(
  scenario: AnyScenario,
  callState: CallState,
  answers: DecisionResult,
  acceptThreshold: number,
  callerText: string | undefined
): Partial<CallData> | undefined {
  const extraction = scenario.extraction;
  if (!extraction || !callerText) return undefined;
  const answered = Object.entries(answers)
    .filter(([id, answer]) => id.startsWith(FIELD_PREFIX) && answer.best === 'yes' && (answer.p.yes ?? 0) >= acceptThreshold)
    .map(([id]) => id.slice(FIELD_PREFIX.length));
  const missing = missingFieldsFor(scenario, callState);
  const fields = answered.filter((field) => Object.hasOwn(missing, field));
  if (fields.length === 0) return undefined;
  return { [extraction.factKey]: Object.fromEntries(fields.map((field) => [field, callerText])) };
}

/** Adds extracted fields to a scenario's decision effects. */
export function withExtraction(effects: DecisionEffects, extracted: Partial<CallData> | undefined): DecisionEffects {
  if (!extracted) return effects;
  return { ...effects, callData: mergeOverrides(effects.callData ?? {}, extracted) };
}

/** "extract" mode: what the side thread is asked to do, for the fields still missing. */
export function extractionPrompt(scenario: AnyScenario, fields: Record<string, string>): string {
  return scenario.prompts.extraction({ fields: Object.entries(fields).map(([field, description]) => ({ field, description })) });
}
