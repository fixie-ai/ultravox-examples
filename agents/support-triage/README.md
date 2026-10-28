# Support triage agent

An inbound support agent for **Acme Internet**, a fictional internet provider. It greets the caller, finds their account, works out what kind of problem they have, asks only for the details it still needs, walks them through a knowledge-base fix, and creates a ticket for a person when the fix doesn't work.

It runs on Ultravox like any agent you'd deploy (web, phone or text), and it comes with a web debugger that shows, live, why the call moves the way it does.

## What this example shows

- **[HTTP tools](https://docs.ultravox.ai/tools/custom/http-vs-client-tools) on a stateless tool server.** The agent's
  tools (`lookupAccount`, `createTicket` and the state machine's own `updateState`) are HTTP endpoints on a small
  server you can run anywhere.
- **A state machine in Ultravox's [call state](https://docs.ultravox.ai/agents/guiding-agents#tool-state).** Every
  tool request carries the call's state, and every response returns the new state. The server keeps nothing.
- **Goals, not scripts.** Each state gives the agent a goal in plain language. States the caller already answered
  are skipped, so a caller who says everything in one sentence is never asked twice.
- **A decision model checking each step.** [Jev](https://docs.inworld.ai/router/decisions) (on Inworld) is a fast
  classifier: it reads the conversation and returns a probability for each option of a multiple-choice question,
  without generating text. When the agent says a step is done, it's applied only if Jev agrees the caller said so.
- **A debugger on the call's [data connection](https://docs.ultravox.ai/apps/datamessages).** Every turn, tool call,
  Jev decision, state change, response time and the estimated cost, as it happens.

## What you need

- **Node.js 22.9+** and **pnpm 10+** (`npm install -g pnpm`).
- **An Ultravox API key**, from [Ultravox settings](https://app.ultravox.ai/settings).
- **Optional: an Inworld API key** for Jev, from the [Inworld Portal](https://platform.inworld.ai) (the Base64
  credential). Without one, a keyword-matching stand-in makes the decisions: fine for trying the example, but its
  "probabilities" aren't real. The Decisions API isn't available in workspaces with zero data retention.
- **A browser with a microphone**, to talk to the agent.

Test calls are real Ultravox calls: about $0.05 a minute, so a short test call costs around $0.02. Jev bills input
tokens only, a fraction of a cent per call.

## Quick start

```bash
cd agents/support-triage
pnpm install
cp .env.example .env    # set ULTRAVOX_API_KEY, and INWORLD_API_KEY if you have one
pnpm dev
```

`pnpm dev`:

1. starts the tool server (port 8787) and the devtools server (port 8788);
1. opens two free [Cloudflare quick tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
   so Ultravox can reach them (no Cloudflare account needed; the `cloudflared` binary downloads on first run);
1. saves the agent on Ultravox as `acme-support-triage`, with its tools pointing at the tunnel (the URL changes
   every run, so this happens every time);
1. starts the web debugger on http://localhost:5173.

Open the debugger, leave the settings at their defaults (model **default**, observer **Off**, details **Agent passes
them**), click **Start Call**, and talk. The **What to say** tab has lines to try in each state and full test calls.
Use one of these fictional customers:

| Name | Email | Account number |
|---|---|---|
| Jordan Lee | jordan.lee@example.com | 100234 |
| Priya Shah | priya.shah@example.net | 100871 |
| Marcus Bell | marcus.bell@example.org | 101552 |

For example: "Hi, I was charged twice this month, 79.99 on September 1st." then "Account 100234." The agent skips
straight past the questions you already answered.

## Where things are

```
agent/        The agent: everything you edit to make it yours
  prompts.ts    Every word the agent (and the decision model) reads
  flow.ts       The states and how the call moves between them
  tools.ts      Your tools: lookupAccount, createTicket
  ultravox.ts   Voice, who speaks first, model, built-in tools
toolServer/   The HTTP backend Ultravox calls. You deploy this.
engine/       The machinery that runs the agent: the state machine, putting the prompts together, the Jev check
devtools/     Development only: the debugger, scripted calls, pnpm prompts
docs/         prompts.md (every prompt, rendered) and sample-dialogs.md
```

**`agent/prompts.ts` is what the agent hears; `agent/flow.ts` is how the call moves.** Every state and action has an
entry in both: its goal and meaning in `prompts.ts`, its transitions and conditions in `flow.ts`. TypeScript fails if
one is missing. To read every prompt as it's sent, open [`docs/prompts.md`](docs/prompts.md); `pnpm prompts`
regenerates it, and a test fails while it's out of date, so prompt changes show up as a readable diff.

You can change `engine/`, but adapting the example to your use case shouldn't require it. See
[`agent/README.md`](agent/README.md) for what each file in `agent/` holds.

## How it works

```
           ┌───────────── Ultravox ──────────────┐
caller ──▶ │ agent: prompt, voice, HTTP tools,   │ ──HTTP tools──▶ tool server (toolServer/)
           │ call state (the state machine)      │                  └─▶ Jev (Inworld)
           └───────────────┬─────────────────────┘
                           │ data connection (developer tools only)
                           ▼
                devtools server ──▶ web debugger, text-call, compare
```

**The call follows a set of states** (`agent/flow.ts`):

```
greeting → identify_account → classify_issue → collect_details → self_serve → resolved → call_ended
                                                                      └──────▶ escalate ─┘
```

A caller can ask for a person from any state (`request_human`), and a caller with a second problem goes back to
`classify_issue` (`new_issue`). Each state gives the agent a goal (`agent/prompts.ts`), which it gets in the result of
the tool call that enters the state:

```
Goal: Collect what's still needed for a billing issue: charge_date (the date of the charge).
Don't: Ask again for charge_amount, billing_problem (already collected). Ask more than one question at a time. ...
When done: Call updateState with "details_collected" and additionalData.details with the keys charge_amount, ...
```

**The agent moves the call on.** When a state's goal is met, the agent calls `updateState` with the action that
matches what happened (`"details_collected"`) and any facts the caller gave. Each action can have a condition: if
it's too early, the agent is told why (for example, which details are still missing) and keeps going.

**The state lives in the call.** Ultravox sends the call state (`KNOWN_PARAM_CALL_STATE`), the conversation
(`KNOWN_PARAM_CONVERSATION_HISTORY`), the call id and the call's metadata with every tool request. The tool server
answers with the complete new state in the `X-Ultravox-Update-Call-State` header, which replaces the old one. Besides
the state machine, the state keeps a short record of each decision, so every call carries its own audit trail.

**Skipping what's already answered.** A state can skip itself when its question is answered (`autoAdvance`). This
runs after every change: when `lookupAccount` finds the account, the call moves on right away; when the caller gave
the category and the details in their first sentence, `classify_issue` and `collect_details` are skipped.

**The decision check** (`engine/decision/`). On every `updateState` call, Jev answers:

- **`outcome`**: which of the state's actions the conversation supports, or `not_yet`, `caller_question`,
  `off_topic` or `opt_out` (the caller wants to stop);
- the agent's own questions (`agent/decisions.ts`): `category` (in `greeting` and `classify_issue`), `frustration`
  (in every state) and `fixed` (in `self_serve`).

| Jev says | What happens |
|---|---|
| The agent's action has p ≥ 0.8, or it's the top option with p ≥ 0.5 | Applied |
| Another action has p ≥ 0.8 | Not applied; the agent is told what the caller seems to mean |
| A side question or off-topic wins | Not applied, with guidance |
| `opt_out` wins | Decided on the other options; the agent is told to keep it short |
| Anything else | Not applied: ask one clarifying question |
| Error, or no answer within 600 ms | Applied anyway (the call never waits long on Jev) |

Where Jev is confident, its answers become call data: the issue's `category`, and `frustration: angry`, which adds
"offer to connect them with a person now" to every goal and asks for a high-priority ticket. Actions that depend on a
tool result rather than the conversation, like `account_verified`, aren't checked by Jev; their conditions check the
tool result instead.

**Knowledge base: a placeholder.** `agent/mockKnowledgeBase.ts` has six short articles, picked by keyword, so test
calls are predictable. When the call reaches `self_serve`, the tool server searches it and puts the article's steps in
the agent's goal, so the agent walks the caller through vetted steps instead of improvising, and skips a fix the
caller already tried. Production needs a real retrieval system; see
[Using a real knowledge base](#using-a-real-knowledge-base).

## Developer tools

The devtools server creates test calls from the saved agent and adds a
[data connection](https://docs.ultravox.ai/apps/datamessages) back to itself. Ultravox streams the call's data
messages there (transcripts, state, call events and `tool_used`, which carries the call state after each tool), and
the server relays them to the debugger and the scripts. The agent doesn't depend on any of it.

- **Call timeline** (left): caller and agent turns; each agent response's timing; tool calls with their latency
  (side-thread tools tagged with their thread); Jev decisions with probability bars and an expandable "What Jev was
  asked"; and state changes, including skipped states.
- **State graph** (top right): the path the call took, numbered; skipped states dashed; the current state blue;
  possible next states amber. Click a state to inspect it.
- **Inspector** (bottom right): the selected state's instruction, its actions and the Jev checks that ran there; the
  **What to say** guide; and the raw call data.
- **Estimated cost** (top bar): Ultravox minutes plus Jev input tokens.
- **Caller view** hides the developer tools and shows only the conversation.
- **`?callId=<id>`** opens one of the last 50 calls this devtools server created since it started, read-only.

The devtools server listens only on 127.0.0.1, and only the data connection answers through its tunnel. The
debugger's API and event stream refuse requests from the tunnel, from other hosts and from other websites, so nobody
else can create calls on your account or read them.

### Scripted calls

With `pnpm dev` running, in another terminal:

```bash
pnpm text-call                                          # a scripted billing call
pnpm text-call "My internet is down." "100871"          # your own caller lines
pnpm compare                                            # every test call (7 calls, about $0.15)
pnpm compare --runs 3                                   # repeat each call (LLM runs vary)
```

`text-call` plays the caller's lines as text over a real call and prints each turn, tool call, Jev decision and state
change, then the path, timing, estimated cost and a debugger link. `compare` runs the test calls in
`devtools/evals/support.ts` and reports which passed, response times, Jev checks and estimated cost per call, and
saves the results to `devtools/results/`. Both take `--model`/`--models`, `--observer`/`--observers` and `--details`
(see [Experiments](#experiments)).

## Deploy the agent

1. **Run the tool server** anywhere Ultravox can reach over HTTPS: `pnpm start:tools` (a [Hono](https://hono.dev)
   app, `toolServer/index.ts`), with `INWORLD_API_KEY` and a long random `TOOLS_SECRET` set.
1. **Save the agent:** `TOOLS_SECRET=… pnpm agent:sync -- --tools-url https://tools.example.com`. Every tool then
   sends the secret in an `X-Tool-Secret` header, and the tool server refuses calls without it, so only your agent's
   calls can use your tools (and your Jev credits). The secret is stored in the agent, where your Ultravox API key can
   read it; the model never sees it.
1. **Create calls** from `acme-support-triage` the usual ways:
   [`POST /api/agents/{agentId}/calls`](https://docs.ultravox.ai/api-reference/agents/agents-calls-post), a phone
   number, or the Ultravox console. No data connection or developer tools are needed. (The observer and the
   extraction thread described below are triggered from a data connection, so they need a service of your own.)

## Using a real knowledge base

The mock knowledge base is there to get started. For production, use a retrieval (RAG) system. Two ways:

- **An Ultravox corpus** ([docs](https://docs.ultravox.ai/tools/rag/overview)). Ultravox hosts the knowledge base:
  create a corpus, add your help-center pages (crawled) or documents (uploaded), and give the agent the built-in
  [`queryCorpus`](https://docs.ultravox.ai/tools/built-in-tools#querycorpus) tool in `agent/ultravox.ts`:

  ```ts
  builtInTools: [{ toolName: 'hangUp' }, { toolName: 'queryCorpus', parameterOverrides: { corpus_id: '<your corpus id>' } }],
  ```

  Then the agent searches when it needs to, so change `self_serve`'s goal in `agent/prompts.ts` to say "search the
  knowledge base with queryCorpus, then walk the caller through what it says", and in `agent/flow.ts` remove the
  state's server-side search (`enter`) and its `issue_resolved` condition, which checks for the server's article.
  This is the least work, but the agent decides when and what to search.
- **Your own search, called by the tool server.** Keep the design above and replace `searchMockKnowledgeBase` (called
  from `self_serve`'s `enter` hook in `agent/flow.ts`) with your search. The agent keeps getting vetted steps in its
  goal. State hooks are synchronous today, so a search that calls a service needs them to become async.

## Make it your own

Everything specific to the support agent is in `agent/`. To build a different agent, say a lead qualification call,
change these files:

1. **Name your states and actions** in `agent/flow.ts`, as string unions:

   ```ts
   export type LeadState = 'greeting' | 'qualify' | 'book_demo' | 'call_ended';
   export type LeadAction = 'interested' | 'qualified' | 'not_a_fit' | 'demo_booked' | 'end_call' | 'do_not_call';
   ```

   `not_yet`, `caller_question`, `off_topic` and `opt_out` are reserved: the decision check uses them.

1. **Write how the call moves** in `agent/flow.ts`: each state's actions, their conditions, and the rules that skip a
   state whose question is already answered.

   ```ts
   qualify: {
     description: 'Check company size and timeline',   // for the debugger
     actions: {
       qualified: { nextState: 'book_demo', condition: (callData) => (hasDetails(callData) ? true : conditions.needsSizeAndTimeline) },
       not_a_fit: { nextState: 'call_ended' },
     },
     // Skip this state if the caller already gave both.
     autoAdvance: (callData) => (hasDetails(callData) ? 'qualified' : undefined),
   },
   ```

   - `condition` returns `true`, or a reason the agent sees if it tries the action too early (write the reasons in
     `prompts.ts`'s `conditions`).
   - `updateData` sets call data when the transition happens.
   - `enter` returns call data to add when the call arrives in the state (the support agent searches the knowledge
     base there).
   - `autoAdvance` returns an action to take right away, to skip a state whose question is already answered.
   - A state with no actions is terminal. Global actions (`globalActions`) work from any state, like `request_human`.

1. **Write what the agent hears** in `agent/prompts.ts`: the persona at the top of the system prompt, a goal for every
   state, and what every action means. Write goals, not lines to say:

   ```ts
   qualify: () => ({
     goal: 'Find out the company size and when they want to buy.',
     dont: ['Ask about budget; sales handles that.'],
     whenDone: ['Call updateState with "qualified" and additionalData.details with company_size and timeline.'],
   }),
   ```

   The rest of the file (how instructions are laid out, the feedback the engine gives, the decision model's wording)
   rarely needs changing; its comments say which parts the engine relies on.

1. **Add your tools** in `agent/tools.ts`: each has parameters and a `run` function that returns text for the agent,
   plus call data your conditions can check. Their descriptions go in `prompts.ts`'s `tools`. The tool server serves
   each one at `POST /tools/<name>`. If a tool's data lets the call move on, it does so right away.

1. **Set up the rest:** the Ultravox settings in `agent/ultravox.ts`, sample data in `agent/settings.ts`, which fact
   keys the agent may set (`modelWritableKeys`) in `agent/index.ts`, and, optionally, your own decision model
   questions and what their answers do in `agent/decisions.ts`.

1. **Test it** like `agent/sampleDialogs.test.ts`: `CallDriver` (`engine/testDriver.ts`) plays the agent's tool calls
   the way the tool server runs them, so you can check each caller path without a live call. Run `pnpm prompts` and
   read `docs/prompts.md`. For the debugger's **What to say** tab, edit `devtools/web/debugger/guides/support.ts`; for
   `pnpm compare`, edit the test calls in `devtools/evals/support.ts`.

## Experiments

The debugger's pickers and the scripts' flags let you compare a few alternatives on the same test calls.

**Models.** The agent uses Ultravox's default model unless you pick one. A call created from a saved agent can't
change the agent's model, so each model is its own saved agent (`acme-support-triage-<model>`), created or updated
the first time you use it in a run. `pnpm compare --models default,<model>` compares them.

**Observer.** The call relies on the agent calling `updateState`, and sometimes it doesn't. The observer checks
**every caller turn** with Jev, asking the same questions `updateState`'s check would. When the caller has met the
goal (or something worth recording happened, like the caller getting angry), it makes the agent run `updateState`
with the observer's decision, so the step goes through the normal path. That forced call carries a marker signed with
`OBSERVER_SECRET`; the marker only works once, in its own call, within two minutes. Two ways to run it:

| Observer | How it runs |
|---|---|
| **Ultravox thread + HTTP tool** | After each caller turn, a side [thread](https://docs.ultravox.ai/agents/threads) calls the `observeTurn` tool, which sends the forced call to the main conversation. Something still has to start the thread on each turn; here, the data connection. |
| **Data connection** | A service on the call's data connection runs the check and sends the forced call itself. In development that's the devtools server. |

**Capturing free-text answers.** Some answers are free text ("when did it start?"). The agent is supposed to pass
them along, and sometimes doesn't, so the call stalls. The **details** setting (sent as call metadata) picks how
they're captured:

| Details | How | Cost |
|---|---|---|
| **Agent passes them** | Only what the agent sends | Nothing extra |
| **Jev checks each field** | Each Jev check also asks, per missing field, "did the caller just say this?" A confident yes stores the caller's words. | A few more Jev tokens |
| **Extraction thread** | After each caller turn, a side thread (one LLM generation) pulls out the missing fields and sends them to the main conversation | One generation per turn, not in the cost estimate |

## Reference

### Settings

In `.env` (or `.env.local`). Only `ULTRAVOX_API_KEY` is required.

| Variable | Default | |
|---|---|---|
| `ULTRAVOX_API_KEY` | | Ultravox API key |
| `INWORLD_API_KEY` | | Inworld key for Jev (the Base64 credential from the Inworld Portal) |
| `DECISION_PROVIDER` | `jev` with an Inworld key, else `heuristic` | `heuristic` is the offline keyword stand-in |
| `DECISION_MODEL` | `typesafe/jev-latest` | |
| `DECISION_CHECK` | on | `off` makes every decision without Jev |
| `DECISION_ACCEPT` | `0.8` | Probability to accept an action, or to prefer another option |
| `DECISION_FLOOR` | `0.5` | A top-ranked action is accepted from this probability |
| `DECISION_TIMEOUT_MS` | `600` | How long `updateState` waits for Jev (it answers within 600 ms about 99% of the time) |
| `AGENT_NAME` | `acme-support-triage` | The saved Ultravox agent (plus `-<model>` for other models). If several people run `pnpm dev` on one Ultravox account, give each their own: the last one started takes over the agent. |
| `TOOLS_SECRET` | new each `pnpm dev` | The tool server only answers tool calls that carry it; `agent:sync` puts it in the agent's tools |
| `TOOLS_PUBLIC_URL` | | The tool server's public URL, for `agent:sync` without `--tools-url` |
| `OBSERVER_SECRET` | new each `pnpm dev` | Signs the observer's forced tool calls; shared by the tool server and whatever runs the observer |
| `OBSERVER_REACTION` | `speaks-once` | How the agent reacts after a forced call. `speaks-once` stays quiet if it already answered the turn. |
| `INWORLD_BASE_URL` | `https://api.inworld.ai` | |
| `TOOLS_PORT` | `8787` | |
| `DEVTOOLS_PORT` | `8788` | |
| `DEVTOOLS_WEB_PORT` | `5173` | The debugger's port. If it's taken, the debugger won't start; pick another. |
| `DEVTOOLS_URL` | `http://127.0.0.1:8788` | Where `text-call` and `compare` reach the devtools server |
| `VITE_ULTRAVOX_PRICE_PER_MINUTE` | `0.05` | For the cost estimate |
| `VITE_ULTRAVOX_BILLING_INCREMENT_SECONDS` | `6` | Partial increments round up |
| `VITE_JEV_PRICE_PER_MILLION_INPUT_TOKENS` | `0.042` | Jev bills input tokens only |
| `VITE_EXTRA_MODELS` | | More models for the debugger's model picker, comma-separated, for models your account can use that Ultravox's model list doesn't show |

### Code layout

```
agent/                  The agent (see agent/README.md)
toolServer/             The HTTP tool server: index.ts starts it, app.ts has the routes, handlers.ts the logic,
                        callState.ts what's kept in Ultravox's call state
engine/                 Runs the agent
  stateMachine.ts       Moving between states, skipping what's already answered
  prompt.ts             Putting the prompts together (the text is in agent/prompts.ts)
  ultravoxTools.ts      The Ultravox tools and call template; ultravoxAgents.ts saves them on Ultravox
  decision/             The Jev check, details capture, decision model providers
  observer/             The per-turn observer and its signed marker
  testDriver.ts         CallDriver, for tests
devtools/               Not part of the agent
  dev.ts                pnpm dev: servers, tunnels, saving the agent, debugger
  server/               Devtools server: creates test calls, receives the data connection
  shared/               The call model built from data messages; cost
  web/                  The debugger (Vite + React)
  prompts.ts            pnpm prompts
  text-call.ts          pnpm text-call (textCall.ts runs the call; compare.ts and evals/ are pnpm compare)
docs/
  prompts.md            Every prompt, rendered (pnpm prompts)
  sample-dialogs.md     Scripted caller paths, tested in agent/sampleDialogs.test.ts
```

### Tests

```bash
pnpm test    # no keys or network needed
```
