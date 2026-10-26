# Sample dialogs: support triage

Five scripted caller paths through the support scenario, each with the state sequence it should produce.
`agent/sampleDialogs.test.ts` plays each one against the engine. The tests play the model's side
(tool calls and `updateState` actions) and check the states the call goes through. As on the tool server, a tool
result can move the call on by itself: a successful `lookupAccount` takes the call past `identify_account`, and a
second failed lookup continues unverified.

The agent lines are examples of the kind of thing the agent should say. They aren't scripts, and the agent's
wording will vary from call to call.

Sample accounts (all fictional):

| Name | Email | Account number |
|---|---|---|
| Jordan Lee | jordan.lee@example.com | 100234 |
| Priya Shah | priya.shah@example.net | 100871 |
| Marcus Bell | marcus.bell@example.org | 101552 |

---

## 1. Fixed through a knowledge-base article

| Speaker | Says | Agent action |
|---|---|---|
| Agent | Hi, this is Riley, Acme Internet's virtual assistant. How can I help? | |
| Caller | Hi, my internet keeps dropping. | `issue_stated` with summary, `category: technical`, `details.symptom` |
| Agent | Sorry about that. What's the email or account number on your account? | |
| Caller | It's jordan dot lee at example dot com. | `lookupAccount` → found; the call moves on (`classify_issue` skipped) |
| Agent | Thanks, Jordan. When did it start, and have you tried restarting the router? | |
| Caller | Since this morning. No, I haven't restarted anything. | `details_collected` |
| Agent | Let's try that. Unplug the router, wait 30 seconds, and plug it back in. | (steps from the "Restart your router" article) |
| Caller | OK, it's back. Thanks! | `issue_resolved`, then `end_call` |

**States:** `greeting → identify_account → classify_issue (skipped) → collect_details → self_serve → resolved → call_ended`

## 2. Not fixed, so a ticket is created

| Speaker | Says | Agent action |
|---|---|---|
| Caller | My internet is down. | `issue_stated` (technical) |
| Caller | My account number is 100871. | `lookupAccount` → found; the call moves on |
| Caller | Since last night, and yes, I already restarted the router. | `details_collected` |
| Agent | Is the light on the router red or green? | (steps from the "Check for an outage" article) |
| Caller | Still red. | `not_resolved` |
| Agent | I'll get a specialist on this. Your ticket number is A C M E, 1 0 4 2. They'll call you within one business day. | `createTicket`, then `end_call` |

**States:** `greeting → identify_account → classify_issue (skipped) → collect_details → self_serve → escalate → call_ended`

## 3. Issue and details in the first sentence

| Speaker | Says | Agent action |
|---|---|---|
| Caller | Hi, I was charged twice this month, 79.99 on September 1st. | `issue_stated` with `category: billing` and all three billing details |
| Caller | Account 100234. | `lookupAccount` → found; the call moves on (`classify_issue` and `collect_details` skipped) |
| Agent | The second charge is usually a pending authorization. It drops off by itself within 3 to 5 business days. | (steps from the duplicate-charge article) |
| Caller | Oh, so it's just pending. Got it. | `issue_resolved`, then `end_call` |

**States:** `greeting → identify_account → classify_issue (skipped) → collect_details (skipped) → self_serve → resolved → call_ended`

## 4. Account not found, so the caller continues unverified

| Speaker | Says | Agent action |
|---|---|---|
| Caller | I can't get into my account. | `issue_stated` (no category yet) |
| Caller | sam@example.com | `lookupAccount` → not found, `account_not_found` |
| Agent | I couldn't find that one. Could you spell it, or give me the account number? | |
| Caller | s.a.m@example.com | `lookupAccount` → not found; the second miss continues unverified by itself |
| Agent | I still can't find it, but I can help anyway. Are you locked out, or did you forget your password? | |
| Caller | I forgot my password. | `issue_classified` with `category: account_access` and `details.access_problem` |
| Agent | (walks through the password reset) | `issue_resolved`, `end_call` |

**States:** `greeting → identify_account → identify_account → classify_issue → collect_details (skipped) → self_serve → resolved → call_ended`
(`callData.verified` is `false`.)

## 5. Caller asks for a human mid-flow

| Speaker | Says | Agent action |
|---|---|---|
| Caller | There's a charge on my bill I don't recognize. | `issue_stated` (billing, `billing_problem`) |
| Caller | marcus.bell@example.org. It's twelve dollars. | `lookupAccount` → found; then `details_collected` with `details.charge_amount` (rejected: the date is still missing) |
| Agent | And what date was the charge? | |
| Caller | Honestly, just get me a person. | `request_human` (global action) |
| Agent | Of course. I've passed this to a specialist with what you've told me. Your ticket number is A C M E, 1 0 4 2. | `createTicket` (the ticket keeps the account and the billing details), then `end_call` |

**States:** `greeting → identify_account → classify_issue (skipped) → collect_details → escalate → call_ended`
