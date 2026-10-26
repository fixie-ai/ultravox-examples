import { ScenarioTool } from '../engine/types';
import { CATEGORIES, getDetails } from './fields';
import { createTicket, lookupAccount, PRIORITIES } from './mockBackend';
import { prompts } from './prompts';
import { SupportContext } from './settings';

// ----------------------------------------------------------------------------- //
// Your tools                                                                    //
// ----------------------------------------------------------------------------- //
// The tool server runs each one when the agent calls it (here against the mock  //
// backend) and returns text for the agent plus call data for the flow (whose    //
// conditions and autoAdvance rules check it). Each tool's description, and its  //
// parameters', is in prompts.ts.                                                //
// ----------------------------------------------------------------------------- //

const lookupAccountTool: ScenarioTool<SupportContext> = {
  name: 'lookupAccount',
  parameters: [
    { name: 'email', schema: { type: 'string' } },
    { name: 'accountNumber', schema: { type: 'string' } },
  ],
  run: (params, { callData }) => {
    const customer = lookupAccount(params);
    if (!customer) {
      return {
        result: JSON.stringify({ found: false, next: prompts.toolResults.accountNotFound }),
        callData: { lookup_attempts: Number(callData.lookup_attempts ?? 0) + 1 },
      };
    }
    const account = { accountNumber: customer.accountNumber, name: customer.name, plan: customer.plan, status: customer.status };
    return {
      result: JSON.stringify({ found: true, account, next: prompts.toolResults.accountFound }),
      callData: { account },
    };
  },
};

const createTicketTool: ScenarioTool<SupportContext> = {
  name: 'createTicket',
  parameters: [
    { name: 'summary', schema: { type: 'string' }, required: true },
    { name: 'category', schema: { type: 'string', enum: [...CATEGORIES] }, required: true },
    { name: 'priority', schema: { type: 'string', enum: PRIORITIES }, required: true },
  ],
  run: (params, { callData }) => {
    const sequence = Number(callData.ticket_count ?? 0);
    const ticket = createTicket(params, sequence);
    // The ticket carries everything collected before the handoff.
    const stored = {
      ...ticket,
      account: (callData.account as { accountNumber?: string } | undefined)?.accountNumber ?? 'unverified',
      details: getDetails(callData),
    };
    return {
      result: JSON.stringify({ ticketId: ticket.id, priority: ticket.priority, nextSteps: ticket.nextSteps }),
      callData: { ticket: stored, ticket_count: sequence + 1 },
    };
  },
};

export const supportTools = [lookupAccountTool, createTicketTool];
