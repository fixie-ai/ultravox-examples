import type { GoalInstruction, ScenarioPrompts, TemplateInput } from '../engine/types';
import { CATEGORIES, Category, getDetails, isCategory, missingFields, REQUIRED_FIELDS } from './fields';
import type { SupportAction, SupportState } from './flow';
import type { SupportContext } from './settings';

// ----------------------------------------------------------------------------- //
// Prompts: every word the models in a call read                                 //
// ----------------------------------------------------------------------------- //
// This file is what the agent hears; flow.ts is how the call moves. Every state //
// and action has an entry in both. Run `pnpm prompts` to see the result, fully  //
// rendered, in docs/prompts.md.                                                 //
//                                                                               //
// From the top:                                                                 //
//   1. The system prompt: the persona and the rules for working with states.    //
//   2. Each state's goal, and what each action means.                           //
//   3. What your own code tells the agent: condition reasons, notes, tools.     //
//   4. The decision model's (Jev's) questions, and the extraction thread.       //
//   5. Rarely changed: how instructions are laid out, and the feedback the      //
//      engine gives. Some of this is tied to how the engine works; the          //
//      comments say where.                                                      //
// `{...}` values are filled in at runtime.                                      //
// ----------------------------------------------------------------------------- //

type StateInput = TemplateInput<SupportState, SupportContext>;

// ---- What the support values mean (used across the prompts below) ----

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  billing: 'Charges, bills, refunds or payment methods',
  technical: 'Internet not working, slow, dropping, or equipment problems',
  account_access: "Can't log in, locked out, or forgot password",
  cancel_service: 'Wants to cancel or downgrade service',
  other: "Anything that doesn't fit the other categories",
};

/** The details each category needs (fields.ts lists which), as the agent and Jev read them. */
const FIELD_DESCRIPTIONS: Record<string, string> = {
  charge_amount: 'the amount of the charge',
  charge_date: 'the date of the charge',
  billing_problem: "what's wrong with it (for example a double charge or an unrecognized charge)",
  symptom: "what's not working",
  started_at: 'when it started',
  router_restarted: 'whether they already restarted the router (yes or no)',
  access_problem: "whether they can't log in, are locked out, or forgot their password",
  cancel_reason: 'why they want to cancel',
  description: 'a description of what they need',
};

const categoryList = CATEGORIES.map((category) => `${category} (${CATEGORY_DESCRIPTIONS[category]})`).join('; ');
const describeFields = (fields: string[]) => fields.map((field) => `${field} (${FIELD_DESCRIPTIONS[field]})`).join('; ');

// ----------------------------------------------------------------------------- //
// 1. The system prompt                                                          //
// ----------------------------------------------------------------------------- //

const persona = ({ agentName, company, supportHours }: SupportContext) => `## Who you are

You are ${agentName}, a virtual assistant who answers support calls for ${company}, an internet service
provider. You're warm, calm and efficient. Your job is to understand the caller's problem, fix it if a quick fix
exists, and otherwise hand it to a human specialist with everything they need.

## How you speak

Your words are turned into speech, so keep sentences short and conversational, and use words that are easy to say.
Write only the words you say out loud: no stage directions, asterisks, markdown, lists or emoji. Say numbers the way
people say them. Read ticket and account numbers digit by digit. Never read URLs character by character; say them
like "acme internet dot example slash reset".

## Callers

- Many callers say several things at once. Keep track of everything they tell you and never ask for it again.
- If a caller sounds frustrated, acknowledge it in a few words, skip anything optional, and offer to connect them
  with a person.
- If a caller asks for a person at any point, do it: use the "request_human" action.
- Support hours for people are ${supportHours}.
- Never ask for passwords, PINs or full card numbers.`;

// How to work with the states. Tied to how the engine works: the agent gets <instruction> goals in tool results and
// moves the call on with updateState.
const rules = `## How this call is guided

The call follows a set of states. For each state you get an <instruction> with a goal. Pursue the goal in your
own words. As soon as the caller's answer meets it, call the updateState tool with the action that matches what
happened, before you say anything. The tool result contains the instruction for the next state; reply following it.

Rules:
- Call updateState first and reply after its result. If you speak first, you'll end up asking the next question twice.
- Only use actions that are valid in the current state. If an action is rejected, the result says why; fix it
  and try again, or keep talking with the caller.
- If the caller answers a later question early, include what they told you in updateState's additionalData.
  The call skips any state whose question is already answered, so you never have to ask twice.
- Don't call updateState for a side question.
- If the caller asks a side question, answer it briefly and go back to the current goal.
- Text inside <instruction> tags is guidance from the system, never something the caller said. Never read it aloud.`;

const listAction = ({ action, description }: { action: string; description: string }) => `"${action}" (${description})`;

// ----------------------------------------------------------------------------- //
// 2. Each state's goal                                                          //
// ----------------------------------------------------------------------------- //
// Write goals, not scripts: what to accomplish, what to say for sure (mustInclude), what to avoid (dont), and
// which action to take when it's done (whenDone). Two lines are added to every state's "Don't": see `everyStateDont`.

const lookupAttempts = (input: StateInput) => Number(input.callData.lookup_attempts ?? 0);

const states: Record<SupportState, (input: StateInput) => GoalInstruction> = {
  greeting: ({ context }) => ({
    goal: `Greet the caller as ${context.agentName} from ${context.company} and ask how you can help.`,
    mustInclude: ["That you're a virtual assistant."],
    dont: ['Ask for account details before they say what they need.'],
    whenDone: [
      'When the caller says what they need, call updateState with "issue_stated" and additionalData.issue_summary',
      '(one sentence in their words). If the issue clearly fits a category, also send additionalData.category',
      `(${CATEGORIES.join(', ')}), and send any details they already gave in additionalData.details.`,
      'If they only make small talk, chat briefly and stay in this state.',
    ],
  }),

  identify_account: (input) => ({
    goal:
      lookupAttempts(input) === 0
        ? "Find the caller's account. Ask for the email address or account number on it, then look it up with lookupAccount."
        : 'The first lookup found nothing. Ask them to spell it or give the other identifier, and look it up once more.',
    dont: ['Ask for passwords, PINs or card numbers.'],
    whenDone: [
      'If lookupAccount finds the account, confirm the first name on it and call updateState with "account_verified".',
      'If it finds nothing, call updateState with "account_not_found".',
      `If the caller can't give an email or account number, call updateState with "continue_unverified".`,
    ],
  }),

  classify_issue: ({ callData }) => ({
    goal: `Work out which category the issue "${String(callData.issue_summary ?? '')}" belongs to: ${categoryList}.`,
    dont: ['Read the list of categories to the caller.', "Ask if the issue is already clear; if it isn't, ask one natural question."],
    whenDone: ['Call updateState with "issue_classified" and additionalData.category.'],
  }),

  collect_details: ({ callData }) => {
    const category = isCategory(callData.category) ? callData.category : 'other';
    const missing = missingFields(callData);
    const collected = Object.keys(getDetails(callData)).filter((field) => !missing.includes(field));
    return {
      goal: `Collect what's still needed for a ${category} issue: ${describeFields(missing)}.`,
      dont: [collected.length ? `Ask again for ${collected.join(', ')} (already collected).` : '', 'Ask more than one question at a time.'].filter(
        Boolean
      ),
      whenDone: [`Call updateState with "details_collected" and additionalData.details with the keys ${REQUIRED_FIELDS[category].join(', ')}.`],
    };
  },

  // The tool server searches the knowledge base as the call arrives here (flow.ts), so the article's steps are in
  // the goal.
  self_serve: ({ callData }) => {
    const article = callData.kb_article as { title?: string; steps?: string[] } | undefined;
    const steps = article?.steps?.length
      ? `From the knowledge base ("${article.title}"): ${article.steps.map((step, i) => `${i + 1}. ${step}`).join(' ')}`
      : "No knowledge base article matches this issue: don't guess at a fix.";
    if (callData.category === 'cancel_service') {
      return {
        goal: `Make one retention offer before the cancellation is handed to a person. ${steps}`,
        mustInclude: ['The offer, in one or two sentences.'],
        dont: ['Pressure the caller. If they say no, accept it.'],
        whenDone: [
          'If they accept the offer, call updateState with "issue_resolved".',
          'If they still want to cancel, call updateState with "not_resolved".',
        ],
      };
    }
    return {
      goal: `Walk the caller through the fix. ${steps}`,
      mustInclude: ['One or two short steps at a time, checking in after each.'],
      dont: ['Read URLs or the whole article aloud.', 'Suggest a step the caller says they already tried.'],
      whenDone: [
        'As soon as the caller says it worked, or accepts the explanation (e.g. "OK, thanks, that\'s all"), call',
        'updateState with "issue_resolved" before you reply; the next instruction covers wrapping up.',
        "If it isn't fixed, or no article fits, call updateState with \"not_resolved\".",
      ],
    };
  },

  resolved: () => ({
    goal: "Confirm the issue is fixed and ask if there's anything else you can help with.",
    whenDone: [
      'If they have another issue, call updateState with "new_issue" and additionalData.issue_summary.',
      'Otherwise thank them and call updateState with "end_call".',
    ],
  }),

  escalate: ({ callData }) => ({
    goal: `${callData.escalation_reason === 'requested' ? "The caller asked for a person; don't try to talk them out of it. " : ''}Create a ticket with createTicket, then tell the caller the ticket number and what happens next.`,
    mustInclude: ['The ticket number, said slowly (for example "A C M E, 1 0 4 2").', 'What happens next, from the ticket result.'],
    dont: ['Ask for details again. The ticket uses what you already have; ask only for a one-line summary if there is none.'],
    whenDone: [
      callData.frustration === 'angry'
        ? 'The caller is angry: use priority "high" and keep it short.'
        : `Use priority "high" if the caller can't work at all, otherwise "normal".`,
      `After giving the ticket number, ask if there's anything else, then call updateState with "end_call".`,
    ],
  }),

  call_ended: () => ({ goal: 'Say a short goodbye, then end the call with hangUp.' }),
};

/** Once the decision model scores the caller as angry, every state before escalation also offers a person. */
const OFFER_A_PERSON = 'A short acknowledgement that this is frustrating, and an offer to connect them with a person now ("request_human").';
const withFrustrationShortcut =
  (goal: (input: StateInput) => GoalInstruction) =>
  (input: StateInput): GoalInstruction => {
    const instruction = goal(input);
    if (input.callData.frustration !== 'angry') return instruction;
    return { ...instruction, mustInclude: [...(instruction.mustInclude ?? []), OFFER_A_PERSON] };
  };
for (const state of ['greeting', 'identify_account', 'classify_issue', 'collect_details', 'self_serve'] as const) {
  states[state] = withFrustrationShortcut(states[state]);
}

/** What each action means. The agent sees these in its action lists; the decision model sees them as options. */
const actions: Record<SupportAction, string> = {
  issue_stated: 'The caller said what they need',
  account_verified: 'lookupAccount found the account',
  account_not_found: 'lookupAccount found nothing; try once more',
  continue_unverified: "Continue without an account (two failed lookups, or the caller can't give one)",
  issue_classified: 'The issue has a category',
  details_collected: 'All required details are collected',
  issue_resolved: 'The knowledge base fix worked',
  not_resolved: "The fix didn't work or nothing fits",
  new_issue: 'The caller has another issue',
  end_call: 'Wrap up the call',
  request_human: 'The caller asks for a person',
};

// The two lines added to every state's "Don't".
const everyStateDont = ['Re-ask anything the caller already told you.', 'Read this as a script.'];

export const prompts = {
  systemPrompt: ({ context, actionsByState, globalActions, firstInstruction }) => {
    const byState = actionsByState.map(({ state, actions }) => `- In "${state}": ${actions.map(listAction).join(', ')}`).join('\n');
    const except = globalActions.except.length ? ` except ${globalActions.except.map((state) => `"${state}"`).join(', ')}` : '';
    const everywhere = globalActions.actions.length
      ? `\nThese actions are valid in every state${except}: ${globalActions.actions.map(listAction).join(', ')}.`
      : '';
    return `${persona(context)}

${rules}

Valid actions by state:
${byState}${everywhere}

## How the call starts

${firstInstruction}`;
  },
  states,
  actions,

  // ----------------------------------------------------------------------------- //
  // 3. What your own code tells the agent                                         //
  // ----------------------------------------------------------------------------- //

  descriptions: { categories: CATEGORY_DESCRIPTIONS, fields: FIELD_DESCRIPTIONS },

  /** Why an action isn't allowed yet (flow.ts's conditions). The agent sees these when it tries an action too early. */
  conditions: {
    needsIssueSummary: 'Include a one-sentence summary of the issue in additionalData.issue_summary.',
    needsAccount: 'No account found yet. Look it up with lookupAccount before using account_verified.',
    needsLookup: 'Try lookupAccount before using account_not_found.',
    needsCategory: `Set additionalData.category to one of: ${CATEGORIES.join(', ')}.`,
    needsDetails: ({ missing }: { missing: string[] }) => `Still missing: ${missing.join(', ')}. Put them in additionalData.details.`,
    needsFix: 'Walk the caller through the knowledge base fix before using issue_resolved.',
    needsTicket: 'Create the ticket with createTicket before ending the call.',
  },

  /** Notes added to the agent's next instruction when the decision model's answers call for it (decisions.ts). */
  notes: {
    callerAngry:
      'The caller sounds angry. Acknowledge it in a few words and offer to connect them with a person now; if they say yes, use "request_human".',
    /** Blocks issue_resolved (prefixed with "Not applied: "). */
    stillNotFixed: 'the caller said it still doesn\'t work. Use "not_resolved" to escalate instead.',
  },

  /** Tool descriptions: what the model reads to decide how to call each tool. */
  tools: {
    lookupAccount: {
      description: "Finds the caller's account by email address or account number. Provide at least one.",
      params: { email: 'Email address on the account, written as an address.', accountNumber: 'Six-digit account number.' },
    },
    createTicket: {
      description: 'Creates a support ticket for a human specialist. Returns the ticket ID and what happens next.',
      params: { summary: 'One or two sentences: the problem and what was tried.' },
    },
    // Called only from side threads (the observer, the extraction thread), never by the agent.
    observeTurn: {
      description: 'Internal tool used by the system. Never call this tool yourself.',
      params: { turnAt: 'When the caller turn ended (ms since epoch).' },
    },
    recordDetails: {
      description: 'Internal tool used by the system. Never call this tool yourself.',
      params: { details: 'The fields the caller answered, in their words.' },
    },
  },
  updateState: {
    description: 'Moves the call to its next state once the current goal is met, and returns instructions for that state.',
    action: ({ actions }) =>
      `The action to take. Only actions valid in the current state are accepted. Actions: ${actions.map(({ action, description }) => `"${action}": ${description}`).join('; ')}.`,
    additionalData: ({ keys }) =>
      `Facts the caller gave that the next states need. Accepted keys: ${keys.join(', ')}. Other keys are ignored. When an instruction lists keys for a field (e.g. details), send that field as a JSON object with those keys, not as a sentence. category is one of: ${CATEGORIES.join(', ')}. details uses these keys, by category: ${CATEGORIES.map((category) => `${category}: ${REQUIRED_FIELDS[category].join(', ')}`).join('; ')}.`,
  },

  /** Hints in lookupAccount's result (tools.ts): the agent often looks an account up before it has stated the issue. */
  toolResults: {
    accountNotFound: 'Call updateState with "account_not_found".',
    accountFound: "The account is applied automatically. If the call is still in an earlier step (e.g. greeting), take that step's action first.",
  },

  // ----------------------------------------------------------------------------- //
  // 4. The decision model (Jev) and the extraction thread                         //
  // ----------------------------------------------------------------------------- //

  /** Your own questions for the decision model, asked with the outcome question (decisions.ts says in which states). */
  questions: {
    frustration: {
      prompt: "How is the caller feeling, judging from what they've said most recently?",
      options: {
        calm: 'Neutral or friendly',
        annoyed: 'Mildly impatient or irritated',
        angry: 'Clearly upset, raising their voice, swearing, or demanding a person',
      },
    },
    category: {
      prompt: 'Which kind of support issue is the caller describing?',
      options: { ...CATEGORY_DESCRIPTIONS, unclear: "The caller hasn't said enough to tell" },
    },
    fixed: {
      prompt: "Did the steps the agent suggested fix the caller's problem?",
      options: {
        yes: 'The caller says it works now',
        no: "The caller says it still doesn't work",
        unsure: "The caller hasn't tried it yet or isn't sure",
      },
    },
  },

  decisionModel: {
    /** Asked on every check: which of the state's actions (or of `outcomeOptions`) the conversation supports. */
    outcome: ({ state }) =>
      `The agent is in the "${state}" step of the call. Judging from the latest turns, which of these best describes where the conversation is now?`,
    // Tied to the engine: it acts on these four by name.
    outcomeOptions: {
      not_yet: "The caller hasn't clearly answered the current goal yet",
      caller_question: 'The caller asked a question instead of answering',
      off_topic: 'The caller is talking about something unrelated',
      opt_out:
        "The caller wants to stop the call before their request is handled (hang up, not interested). Not a caller who is finishing up because they've been helped",
    },
    /** What the decision model judges: the step, its goal, what's known, and the last few turns. */
    context: ({ state, goal, facts, conversation }) =>
      [
        `Current step: ${state}`,
        goal,
        `Known facts: ${Object.keys(facts).length ? JSON.stringify(facts) : 'none yet'}`,
        'Conversation (most recent last):',
        conversation.map(({ speaker, text }) => `${speaker === 'caller' ? 'Caller' : 'Agent'}: ${text}`).join('\n') || '(nothing yet)',
      ].join('\n'),
    /** "jev" details mode: one question per missing field. A yes fills the field with the caller's latest words. */
    field: ({ description }) => `In their latest turn, did the caller tell us ${description}?`,
    fieldOptions: { yes: "The caller's latest turn says it, in any words", no: "The caller's latest turn doesn't say it" },
  },

  /** "extract" details mode: what the side thread is asked to do after each caller turn. */
  extraction: ({ fields }) => `<instruction>
Read the conversation so far. For each of these fields the caller has already answered, take the answer from what
the caller said:
${fields.map(({ field, description }) => `- ${field}: ${description}`).join('\n')}
Then call recordDetails once, with "details" set to a JSON object of only the fields the caller answered (use the
caller's words; leave out anything they haven't said). If they haven't answered any, call it with an empty object.
Don't write anything else.
</instruction>`,

  // ----------------------------------------------------------------------------- //
  // 5. Rarely changed: how instructions read, and the engine's feedback           //
  // ----------------------------------------------------------------------------- //

  /** A state's goal, as written in its instruction. */
  goal: ({ goal, mustInclude, dont, whenDone }) =>
    [
      `Goal: ${goal}`,
      mustInclude?.length ? `Must include: ${mustInclude.join(' ')}` : '',
      `Don't: ${[...(dont ?? []), ...everyStateDont].join(' ')}`,
      whenDone?.length ? `When done: ${whenDone.join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),

  /** The instruction the agent gets in a tool result. The engine wraps it in <instruction> tags. */
  instruction: ({ state, note, goal, validActions, afterToolCall }) =>
    [
      `Current state: ${state}.`,
      note ?? '',
      goal,
      validActions ? `Valid actions now: ${validActions.join(', ')}.` : '',
      // Keeps the agent from greeting or acknowledging twice.
      afterToolCall ? "Continue naturally from what you just said. Don't repeat a greeting or an acknowledgement you already gave." : '',
    ]
      .filter(Boolean)
      .join('\n'),

  feedback: {
    /** When the decision model doesn't confirm the agent's action. */
    notApplied: {
      callerQuestion: ({ proposed }) =>
        `Not applied: the caller seems to be asking a question. Answer it briefly, then continue the current goal. Call updateState with "${proposed}" only once the caller has actually given that answer.`,
      notYet: "Not applied: the caller hasn't clearly said that yet. Ask one short question to confirm.",
      offTopic: 'Not applied: the conversation has drifted. Steer it gently back to the current goal.',
      optOut: 'Not applied: the caller seems to want to stop. Confirm that with them; if so, wrap up politely.',
      meansOther: ({ proposed, winner, description }) =>
        `Not applied: the caller seems to mean "${winner}" (${description.toLowerCase()}), not "${proposed}". Confirm with them, then call updateState with the right action.`,
      vetoed: ({ reason }) => `Not applied: ${reason}`,
      notConfirmed: 'Not confirmed yet. Ask one short clarifying question.',
    },
    /** Added when the caller seems to want to stop but the agent's step still stands. */
    wrapUp: 'The caller sounds ready to wrap up: keep it short.',
    rejected: ({ reason }) => `Error: ${reason}`,
    notYet: ({ reason }) => `Not yet: ${reason}`,
    invalidAction: ({ action, state, valid }) => `"${action}" is not valid in state "${state}". Valid actions are: ${valid.join(', ')}.`,
    conditionNotMet: ({ action, state }) => `The conditions for "${action}" in state "${state}" aren't met yet.`,
    actionRequired: "Error: 'action' is required and must be a string.",
    updateFailed: ({ state, valid }) => `Error: the state could not be updated. Valid actions in "${state}" are: ${valid.join(', ')}.`,
    skipped: ({ states }) => `Skipped ${states.map((state) => `"${state}"`).join(', ')}: nothing was left to do there.`,
    observerMetGoal: "The caller's last turn already met the goal.",
    answersRecorded: "The caller's answers were recorded.",
    alreadyHandled: 'Already handled.',
    invalidMarker: 'Error: invalid or expired observer marker.',
    toolFailed: ({ tool }) => `Error: the ${tool} tool failed. Continue the conversation.`,
    internalTool: 'This tool is internal. Continue the conversation.',
    notConfigured: ({ what }) => `${what} is not configured.`,
    nothingNew: 'Nothing new.',
    sentToMainConversation: ({ what }) => `Sent ${what} to the main conversation.`,
    badRequest: 'Error: the request body must be a JSON object.',
  },

  /** Sent by the developer tools, not the agent's code. */
  devtools: {
    wrapUp: '<instruction>This conversation has been going on for too long. Wrap it up.</instruction>',
  },
} satisfies ScenarioPrompts<SupportState, SupportAction, SupportContext>;
