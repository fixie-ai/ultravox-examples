import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { MAIN_TOOL } from '../engine/prompt';
import { AnyScenario } from '../engine/types';
import { encodeStateHeader } from './callState';
import { handleToolRequest, LISTENS, ToolDeps, ToolRequestBody } from './handlers';
import { OBSERVER_TOOL, RECORD_DETAILS_TOOL, TOOL_SECRET_HEADER } from '../engine/ultravoxTools';

// ----------------------------------------------------------------------------- //
// HTTP tool server: what Ultravox calls during the agent's calls.               //
// POST /tools/:name with the tool's arguments plus the automatic parameters     //
// (callState, conversation, callId). Responds with the text the agent sees and  //
// the complete new call state in X-Ultravox-Update-Call-State. Stateless, so    //
// it can run anywhere Ultravox can reach.                                       //
// ----------------------------------------------------------------------------- //

export interface ToolServerOptions extends ToolDeps {
  scenario: AnyScenario;
  /** When set, every tool call must carry it in TOOL_SECRET_HEADER (the saved agent sends it). */
  secret?: string;
  log?: (message: string) => void;
}

export function createToolServer(options: ToolServerOptions) {
  const { scenario } = options;
  const log = options.log ?? console.log;
  const toolNames = new Set([MAIN_TOOL, OBSERVER_TOOL, RECORD_DETAILS_TOOL, ...scenario.tools.map((tool) => tool.name)]);
  const app = new Hono();

  // Without the secret, anyone with the URL could run the tools (and spend decision model credits).
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = options.secret ? digest(options.secret) : undefined;
  app.use('/tools/*', async (c, next) => {
    const given = c.req.header(TOOL_SECRET_HEADER);
    if (expected && !(given && timingSafeEqual(digest(given), expected))) return c.text('Unauthorized', 401);
    await next();
  });

  app.post('/tools/:name', async (c) => {
    const name = c.req.param('name');
    if (!toolNames.has(name)) return c.text(`Unknown tool: ${name}`, 404);
    // Without a readable body there's no call state, and answering would reset the call: refuse instead.
    const body = await c.req.json<ToolRequestBody>().catch(() => undefined);
    if (!body || typeof body !== 'object') return c.text(scenario.prompts.feedback.badRequest, 400);
    const started = performance.now();
    try {
      const { result, state, headers } = await handleToolRequest(scenario, name, body, options);
      const decision = state?.lastTool?.decision;
      log(
        `${body.callId ?? '-'} ${name}${body.threadId && body.threadId !== 'UI' ? ` [thread ${String(body.threadId)}]` : ''}` +
          (state ? ` -> ${state.machine.currentState}` : '') +
          (decision ? ` | ${decision.verdict} (${decision.winner ?? '-'}, ${decision.latencyMs} ms)` : '') +
          (headers?.['X-Ultravox-Response-Type'] ? ` | ${headers['X-Ultravox-Response-Type']}` : '') +
          ` | ${Math.round(performance.now() - started)} ms`
      );
      return c.text(result, 200, { ...headers, ...(state ? { 'X-Ultravox-Update-Call-State': encodeStateHeader(state) } : {}) });
    } catch (error) {
      log(`${body.callId ?? '-'} ${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      // The agent sees this, so keep internals out of it; the call state is left as it was. A side thread
      // (observer, extraction) shouldn't react at all.
      const internal = name === OBSERVER_TOOL || name === RECORD_DETAILS_TOOL;
      return c.text(scenario.prompts.feedback.toolFailed({ tool: name }), 200, internal ? LISTENS : undefined);
    }
  });

  app.get('/health', (c) => c.json({ ok: true, scenario: scenario.id, tools: [...toolNames] }));
  return app;
}
