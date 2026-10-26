import { TestGuide } from './types';
import { CUSTOMERS } from '../../../../agent/mockBackend';
import { SupportState } from '../../../../agent/flow';

// What to say when testing the support agent. The scripts match
// docs/sample-dialogs.md (tested in agent/sampleDialogs.test.ts),
// plus a few extras. Shown in the debugger's "What to say" tab.

export const supportTestGuide: TestGuide<SupportState> = {
  sampleData: {
    title: 'Sample accounts (anything else is "not found")',
    columns: ['Name', 'Email', 'Account number', 'Plan'],
    rows: CUSTOMERS.map((customer) => [customer.name, customer.email, customer.accountNumber, customer.plan]),
  },
  handles: [
    'Billing: double or unrecognized charges, updating a payment method',
    'Technical: internet down, slow or dropping (it walks you through a router restart or outage check)',
    "Account access: can't log in, locked out, forgot password",
    'Cancelling service (it makes one retention offer first)',
    'Asking for a person at any point ("just get me a person")',
    'Side questions, like support hours, without losing its place',
    'Saying several things at once ("I was charged 79.99 twice on September 1st")',
  ],
  limits: [
    "Won't ask for or accept passwords, PINs or card numbers",
    'Anything outside the categories (e.g. a partnership question) becomes a ticket for a person',
    "If a knowledge base fix doesn't work, it creates a ticket instead of guessing",
    "If your account can't be found after two tries, it continues without verifying you",
    'Knowledge base, accounts and tickets are mock data; ticket numbers start at ACME-1042',
  ],
  stateHints: {
    greeting: ['Hi, I was charged twice this month.', 'My internet keeps dropping.', "I can't log into my account.", 'I want to cancel my service.'],
    identify_account: ["It's jordan dot lee at example dot com.", 'My account number is 100871.', "I don't know my account number.", 'sam@example.com'],
    classify_issue: ["It's about my bill.", "My wifi isn't working."],
    collect_details: ['It was 79.99 on September 1st.', "Since this morning, and no, I haven't restarted the router.", 'I forgot my password.', "It's too expensive."],
    self_serve: ['OK, that worked, thanks!', "It's still not working.", 'Can you just get me a person?'],
    resolved: ["No, that's everything.", 'Actually, I also have a question about my bill.'],
    escalate: ['OK, thanks.', 'How long will that take?'],
  },
  scripts: [
    {
      title: 'Fixed by a knowledge base article',
      lines: [
        'Hi, my internet keeps dropping.',
        "It's jordan dot lee at example dot com.",
        "Since this morning. No, I haven't restarted anything.",
        "OK, it's back. Thanks!",
        "No, that's all.",
      ],
      expect: 'greeting → identify_account → (classify_issue skipped) → collect_details → self_serve → resolved → call_ended',
    },
    {
      title: 'Not fixed, so a ticket is created',
      lines: [
        'My internet is down.',
        'My account number is 100871.',
        'Since last night, and yes, I already restarted the router.',
        'The light is still red.',
        'OK. What happens now?',
        "No, that's it.",
      ],
      expect: 'greeting → identify_account → collect_details → self_serve → escalate (ticket ACME-1042) → call_ended',
    },
    {
      title: 'Everything in the first sentence',
      lines: ['Hi, I was charged twice this month, 79.99 on September 1st.', 'Account 100234.', "Oh, so it's just pending. Got it, thanks."],
      expect: 'greeting → identify_account → (classify_issue and collect_details skipped) → self_serve → resolved',
    },
    {
      title: "Account can't be found",
      lines: ["I can't get into my account.", 'sam@example.com', 's a m at example dot com', 'I forgot my password.', 'Great, that worked.'],
      expect: 'greeting → identify_account ×3 → classify_issue → self_serve → resolved (unverified)',
    },
    {
      title: 'Ask for a person mid-call',
      lines: ["There's a charge on my bill I don't recognize.", 'marcus.bell@example.org. It was twelve dollars.', 'Honestly, just get me a person.'],
      expect: 'greeting → identify_account → collect_details → escalate (keeps the details) → call_ended',
    },
    {
      title: 'Frustrated caller',
      lines: [
        "This is the third time I'm calling, my internet is down again and it's ridiculous!",
        "I'm furious. This is unacceptable, I want this fixed now!",
        'Fine. 101552.',
      ],
      expect:
        'The agent acknowledges it briefly. Jev scores the first line "annoyed"; once it scores "angry" (second line), the agent offers a person and tickets are high priority',
    },
    {
      title: 'Side question',
      lines: ['My bill looks wrong.', 'Wait, what are your support hours?'],
      expect: 'The agent answers the hours and stays in identify_account (observer: caller_question)',
    },
  ],
};
