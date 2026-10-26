# The agent

Everything that makes this the Acme Internet support agent. Edit these files to make it yours; the engine
(`../engine/`) runs whatever is here, and the tool server (`../toolServer/`) serves it to Ultravox.

| File | What it holds |
|---|---|
| `prompts.ts` | **Every word the agent reads**: the system prompt, each state's goal, what each action means, the reasons and notes it gets, tool descriptions, and the decision model's questions. `pnpm prompts` renders it all into [`docs/prompts.md`](../docs/prompts.md). |
| `flow.ts` | **How the call moves**: the states, their actions, the conditions that guard them, and the `autoAdvance` rules that skip a state whose question is already answered. |
| `tools.ts` | Your tools, `lookupAccount` and `createTicket`: their parameters and what they do. |
| `decisions.ts` | Which of the decision model's own questions are asked in which states (`category`, `frustration`, `fixed`), and what confident answers do. |
| `ultravox.ts` | How the agent is set up on Ultravox: voice, who speaks first, model, built-in tools. |
| `settings.ts` | Company name, agent name, support hours. |
| `fields.ts` | The issue categories and the details each one needs. |
| `mockBackend.ts`, `mockKnowledgeBase.ts` | Placeholders for your CRM, ticketing and knowledge base: three sample customers, predictable ticket IDs (`ACME-1042`, ...), six articles. |
| `index.ts` | Puts it together. |
| `sync.ts` | `pnpm agent:sync`: saves the agent on Ultravox. |

Every state and action has an entry in both `prompts.ts` (what the agent hears) and `flow.ts` (how the call moves);
TypeScript fails if one is missing.

## Flow

```
greeting ─issue_stated─▶ identify_account ─account_verified / continue_unverified─▶ classify_issue
   ─issue_classified─▶ collect_details ─details_collected─▶ self_serve ─issue_resolved─▶ resolved ─end_call─▶ call_ended
                                                                  └─not_resolved─▶ escalate ─end_call─▶ call_ended
identify_account ─account_not_found─▶ identify_account   (one more try; a second miss continues unverified)
resolved ─new_issue─▶ classify_issue                     (a second problem in the same call)
request_human (any state before escalate) ─▶ escalate
```

## What it shows

- **Skipping questions the caller already answered.** A caller who opens with "Hi, I was charged twice this month"
  never hears "what's this about?" The agent passes `category: "billing"` with `issue_stated`, and
  `classify_issue`'s `autoAdvance` skips the state.
- **Several fields in one sentence.** "I was charged 79.99 twice on September 1st" fills `charge_amount`,
  `charge_date` and `billing_problem`. `collect_details` asks only for what's still missing, and is skipped
  entirely when nothing is missing.
- **"Just get me a person" works from any state.** `request_human` is a global action. It moves the call to
  `escalate` and keeps everything collected so far, and `createTicket` attaches it to the ticket.
- **Frustrated callers get a faster path.** The persona tells the agent to acknowledge frustration briefly, skip
  optional steps, and offer a person. Every decision model check also scores `frustration`; once the caller is
  confidently `angry`, every goal before escalation includes "offer a person now", and the agent is asked for a
  high-priority ticket.
- **Guard rails without scripts.** Conditions keep the model honest: `account_verified` needs a successful
  `lookupAccount` (a successful lookup moves the call on by itself), `details_collected` names the missing fields,
  `self_serve` always has a knowledge-base article (the server searches as the call arrives), and `end_call` from
  `escalate` needs a ticket.

Tests: `sampleDialogs.test.ts` plays the five calls in [`docs/sample-dialogs.md`](../docs/sample-dialogs.md);
`flow.test.ts` checks the flow's rules. The debugger's "What to say" guide is in
`../devtools/web/debugger/guides/support.ts`.
