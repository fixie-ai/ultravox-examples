import { Scenario } from '../engine/types';
import { applySupportDecision, supportDecisionQuestions } from './decisions';
import { missingFields } from './fields';
import { SupportAction, SupportState, supportGlobalActions, supportStates } from './flow';
import { prompts } from './prompts';
import { SupportContext, supportContext } from './settings';
import { supportTools } from './tools';
import { ultravox } from './ultravox';

// ----------------------------------------------------------------------------- //
// The agent, put together from this folder:                                     //
//   prompts.ts    every word the agent (and the decision model) reads          //
//   flow.ts       the states and how the call moves between them               //
//   tools.ts      your tools (lookupAccount, createTicket)                       //
//   decisions.ts  the decision model's own questions, and what answers do       //
//   ultravox.ts   voice, who speaks first, model, built-in tools                 //
//   settings.ts   company, agent name, support hours                             //
// ----------------------------------------------------------------------------- //

export const supportScenario: Scenario<SupportState, SupportAction, SupportContext> = {
  id: 'support',
  label: 'Acme Internet support triage',
  context: supportContext,
  prompts,
  ultravox,
  initialState: 'greeting',
  states: supportStates,
  globalActions: supportGlobalActions,
  // The only additionalData keys the agent may set; everything else is dropped.
  modelWritableKeys: ['issue_summary', 'category', 'details', 'notes'],
  tools: supportTools,
  // Where the caller's free-text answers are captured, for the "jev" and "extract" details modes.
  extraction: {
    states: ['collect_details'],
    factKey: 'details',
    missing: (callData) => Object.fromEntries(missingFields(callData).map((field) => [field, prompts.descriptions.fields[field]])),
  },
  decisionQuestions: supportDecisionQuestions,
  applyDecision: applySupportDecision,
};
