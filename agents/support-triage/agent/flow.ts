import { CallData, StateAction, StateDefinition } from '../engine/types';
import { getDetails, isCategory, missingFields } from './fields';
import { articleSummary, searchMockKnowledgeBase } from './mockKnowledgeBase';
import { prompts } from './prompts';
import { SupportContext } from './settings';

// ----------------------------------------------------------------------------- //
// Flow: the states and how the call moves between them                          //
// ----------------------------------------------------------------------------- //
// greeting -> identify_account -> classify_issue -> collect_details ->          //
// self_serve -> (resolved | escalate) -> call_ended                             //
//                                                                               //
// This file is how the call moves; prompts.ts is what the agent hears in each   //
// state. Each action can have a condition (the reason the agent sees if it's    //
// too early is in prompts.ts), and each state can skip itself (autoAdvance)     //
// when its question is already answered, so "I was charged twice" goes         //
// straight past classify_issue.                                                 //
// ----------------------------------------------------------------------------- //

export type SupportState =
  | 'greeting'
  | 'identify_account'
  | 'classify_issue'
  | 'collect_details'
  | 'self_serve'
  | 'resolved'
  | 'escalate'
  | 'call_ended';

export type SupportAction =
  | 'issue_stated'
  | 'account_verified'
  | 'account_not_found'
  | 'continue_unverified'
  | 'issue_classified'
  | 'details_collected'
  | 'issue_resolved'
  | 'not_resolved'
  | 'new_issue'
  | 'end_call'
  | 'request_human';

type Definition = StateDefinition<SupportState, SupportAction, SupportContext>;
const { conditions } = prompts;

// The caller has two tries at a lookup before continuing unverified.
const MAX_LOOKUP_ATTEMPTS = 2;
const lookupAttempts = (callData: CallData) => Number(callData.lookup_attempts ?? 0);

/** The knowledge base article for the call's issue, skipping any fix the caller already tried. */
function searchForCall(callData: CallData) {
  const details = getDetails(callData);
  const tried = Object.keys(details).filter((field) => /^y(es)?\b/i.test(String(details[field]).trim()));
  const query = `${String(callData.issue_summary ?? '')} ${Object.values(details).map(String).join(' ')}`;
  const article = searchMockKnowledgeBase({ category: callData.category, query, tried });
  return article ? articleSummary(article) : undefined;
}

export const supportStates: Record<SupportState, Definition> = {
  greeting: {
    description: 'Greet the caller and find out what they need',
    actions: {
      issue_stated: {
        nextState: 'identify_account',
        condition: (callData) => (callData.issue_summary ? true : conditions.needsIssueSummary),
      },
    },
  },

  identify_account: {
    description: "Find the caller's account",
    actions: {
      account_verified: {
        nextState: 'classify_issue',
        condition: (callData) => (callData.account ? true : conditions.needsAccount),
        updateData: () => ({ verified: true }),
        // Depends on lookupAccount's result, not on what the caller said, so the decision model doesn't check it.
        decisionCheck: false,
      },
      account_not_found: {
        nextState: 'identify_account',
        condition: (callData) => (lookupAttempts(callData) > 0 ? true : conditions.needsLookup),
        decisionCheck: false,
      },
      continue_unverified: {
        nextState: 'classify_issue',
        updateData: () => ({ verified: false }),
      },
    },
    // Skip if the account was already found, or move on after the second failed lookup.
    autoAdvance: (callData) => {
      if (callData.account) return 'account_verified';
      if (lookupAttempts(callData) >= MAX_LOOKUP_ATTEMPTS) return 'continue_unverified';
      return undefined;
    },
  },

  classify_issue: {
    description: 'Put the issue into one category',
    actions: {
      issue_classified: {
        nextState: 'collect_details',
        condition: (callData) => (isCategory(callData.category) ? true : conditions.needsCategory),
      },
    },
    autoAdvance: (callData) => (isCategory(callData.category) ? 'issue_classified' : undefined),
  },

  collect_details: {
    description: 'Collect the details the category needs',
    actions: {
      details_collected: {
        nextState: 'self_serve',
        condition: (callData) => {
          const missing = missingFields(callData);
          return missing.length === 0 ? true : conditions.needsDetails({ missing });
        },
      },
    },
    autoAdvance: (callData) => (missingFields(callData).length === 0 ? 'details_collected' : undefined),
  },

  self_serve: {
    description: 'Try a knowledge base fix',
    // The server searches the knowledge base as the call arrives, so the agent always has vetted steps
    // (and doesn't need a tool round trip, or to improvise).
    enter: (callData) => ({ kb_article: searchForCall(callData) }),
    actions: {
      issue_resolved: {
        nextState: 'resolved',
        // A knowledge base article was used, or the caller clearly said it's fixed (from the decision model).
        condition: (callData) => (callData.kb_article || callData.caller_confirmed_fixed ? true : conditions.needsFix),
      },
      not_resolved: {
        nextState: 'escalate',
        updateData: (callData) => ({ escalation_reason: callData.category === 'other' ? 'needs_specialist' : 'not_resolved' }),
      },
    },
    // "Other" issues go straight to a person.
    autoAdvance: (callData) => (callData.category === 'other' ? 'not_resolved' : undefined),
  },

  resolved: {
    description: 'Issue fixed; anything else?',
    actions: {
      new_issue: {
        nextState: 'classify_issue',
        // Clear the last issue's working data; the account stays verified.
        updateData: (callData) => ({
          category: undefined,
          details: undefined,
          kb_article: undefined,
          caller_confirmed_fixed: undefined,
          // A ticket from the last issue doesn't cover this one (ticket_count stays, so ticket IDs don't repeat).
          ticket: undefined,
          escalation_reason: undefined,
          resolved_count: Number(callData.resolved_count ?? 0) + 1,
        }),
      },
      end_call: { nextState: 'call_ended' },
    },
  },

  escalate: {
    description: 'Create a ticket for a person',
    actions: {
      end_call: {
        nextState: 'call_ended',
        condition: (callData) => (callData.ticket ? true : conditions.needsTicket),
      },
    },
  },

  call_ended: { description: 'Call over', actions: {} },
};

export const supportGlobalActions: Partial<Record<SupportAction, StateAction<SupportState, SupportContext>>> = {
  request_human: {
    nextState: 'escalate',
    // Everything collected so far stays in call data, so the ticket keeps it.
    updateData: () => ({ escalation_reason: 'requested' }),
  },
};
