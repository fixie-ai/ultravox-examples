import type { TextCallResult } from '../textCall';

// ----------------------------------------------------------------------------- //
// Scripted test calls for the support scenario, with what each should achieve. //
// Used by `pnpm compare` to compare setups on real calls. They follow          //
// docs/sample-dialogs.md plus a few extras. A real LLM drives the agent, so    //
// the checks look at outcomes (states reached, data recorded), not exact paths. //
// ----------------------------------------------------------------------------- //

export interface EvalCase {
  name: string;
  lines: string[];
  /** Returns undefined if the call passed, or why it failed. */
  check: (result: TextCallResult) => string | undefined;
}

const visited = (result: TextCallResult, state: string) => result.path.includes(state);
const callData = (result: TextCallResult) => result.stream.agentState?.machine.callData ?? {};
const autoSkipped = (result: TextCallResult, state: string) =>
  result.stream.events.some((event) => event.kind === 'transition' && event.steps.some((step) => step.automatic && step.from === state));

/** All the conditions must hold; returns the first that doesn't. */
function expect(...conditions: [boolean, string][]): string | undefined {
  return conditions.find(([ok]) => !ok)?.[1];
}

export const supportEvals: EvalCase[] = [
  {
    name: 'Fixed by a knowledge base article',
    lines: [
      'Hi, my internet keeps dropping.',
      "It's jordan dot lee at example dot com.",
      "Since this morning. No, I haven't restarted anything.",
      "OK, I restarted it and it's back. Thanks!",
      "No, that's all.",
    ],
    check: (r) =>
      expect(
        [visited(r, 'self_serve'), 'never reached self_serve'],
        [visited(r, 'resolved'), 'never reached resolved'],
        [!!callData(r).kb_article, 'no knowledge base article']
      ),
  },
  {
    name: 'Not fixed, so a ticket is created',
    lines: [
      'My internet is down.',
      'My account number is 100871.',
      'Since last night, and yes, I already restarted the router.',
      'The light is still red. It still does not work.',
      'OK. What happens now?',
      "No, that's it, thanks.",
    ],
    check: (r) => expect([visited(r, 'escalate'), 'never escalated'], [!!callData(r).ticket, 'no ticket created']),
  },
  {
    name: 'Everything in the first sentence',
    lines: ['Hi, I was charged twice this month, 79.99 on September 1st.', 'Account 100234.', "Oh, so it's just pending. Got it, thanks. That's all."],
    check: (r) =>
      expect(
        [visited(r, 'self_serve'), 'never reached self_serve'],
        [autoSkipped(r, 'collect_details'), 'collect_details was not skipped'],
        [visited(r, 'resolved'), 'never reached resolved']
      ),
  },
  {
    name: "Account can't be found",
    lines: ["I can't get into my account.", 'sam@example.com', 's a m at example dot com', 'I forgot my password.', 'Great, that worked. Thanks.'],
    check: (r) =>
      expect([callData(r).verified === false, 'caller was not marked unverified'], [visited(r, 'self_serve'), 'never reached self_serve']),
  },
  {
    name: 'Asks for a person mid-call',
    lines: ["There's a charge on my bill I don't recognize.", 'marcus.bell@example.org. It was twelve dollars.', 'Honestly, just get me a person.'],
    check: (r) =>
      expect([visited(r, 'escalate'), 'never escalated'], [callData(r).escalation_reason === 'requested', 'escalation reason is not "requested"']),
  },
  {
    name: 'Side question',
    lines: ['My bill looks wrong.', 'Wait, what are your support hours?'],
    check: (r) => {
      const answered = r.stream.events.some((e) => e.kind === 'turn' && e.speaker === 'agent' && /8|eight/i.test(e.text) && /saturday|monday/i.test(e.text));
      return expect([answered, "didn't answer the hours"], [!visited(r, 'classify_issue') || visited(r, 'identify_account'), 'moved on oddly']);
    },
  },
  {
    name: 'Angry caller',
    lines: [
      "This is the third time I'm calling, my internet is down again and it's ridiculous!",
      "I'm furious. This is unacceptable, I want this fixed now!",
    ],
    check: (r) => expect([callData(r).frustration === 'angry', 'frustration was not recorded as angry']),
  },
];
