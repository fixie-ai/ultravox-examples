import { describe, expect, it } from 'vitest';
import { supportScenario } from '../../agent';
import { createDevtools, isLocalHost, isLocalOrigin } from './app';

// Requests the guards refuse never reach Ultravox, so a dummy key is enough.
const { app } = createDevtools({ ultravoxApiKey: 'test-key', publicUrl: 'https://devtools.example', agentPrefix: 'test', scenario: supportScenario, log: () => {} });
const post = (headers: Record<string, string>) => app.request('/api/calls', { method: 'POST', headers, body: '{}' });

describe('devtools server: only this machine may use the API', () => {
  it('refuses requests that came through the tunnel', async () => {
    expect((await post({ host: 'localhost:8788', 'content-type': 'application/json', 'cf-ray': 'x' })).status).toBe(403);
    expect((await app.request('/api/health', { headers: { host: 'abc.trycloudflare.com', 'cf-connecting-ip': '1.2.3.4' } })).status).toBe(403);
  });

  it('refuses another Host (DNS rebinding)', async () => {
    expect((await post({ host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await app.request('/api/health', { headers: { host: 'evil.example:8788' } })).status).toBe(403);
  });

  it('refuses a POST that isn’t JSON (a cross-site form or no-cors fetch)', async () => {
    expect((await post({ host: '127.0.0.1:8788', 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ host: '127.0.0.1:8788' })).status).toBe(415);
  });

  it('answers local requests, and /health from anywhere', async () => {
    const health = await app.request('/api/health', { headers: { host: 'localhost:5173' } });
    expect(health.status).toBe(200);
    expect((await health.json()).observers).toEqual(['off', 'thread']);
    expect((await app.request('/health', { headers: { host: 'abc.trycloudflare.com', 'cf-ray': 'x' } })).status).toBe(200);
  });

  it('accepts only local hosts and origins for the event stream', () => {
    expect(['localhost', 'localhost:5173', '127.0.0.1:8788', 'LOCALHOST'].every(isLocalHost)).toBe(true);
    expect([undefined, '', 'evil.example', 'localhost.evil.example', '127.0.0.1.evil.example:80'].some(isLocalHost)).toBe(false);
    expect([undefined, 'http://localhost:5173', 'http://127.0.0.1:8788', 'https://localhost'].every(isLocalOrigin)).toBe(true);
    expect(['https://evil.example', 'http://localhost.evil.example', 'null', 'file://'].some(isLocalOrigin)).toBe(false);
  });
});
