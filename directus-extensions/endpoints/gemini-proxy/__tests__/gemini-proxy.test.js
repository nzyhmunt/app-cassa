/**
 * @file gemini-proxy.test.js
 * Unit tests for the Directus gemini-proxy endpoint extension.
 *
 * The extension exports a function (router, { env, logger }) => {} that
 * registers a POST handler. We exercise it by constructing a fake router,
 * capturing the registered route, and invoking it with mock req/res objects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function createMockRouter() {
  const routes = {};
  const router = {
    post(path, handler) { routes[`POST ${path}`] = handler; },
    get(path, handler) { routes[`GET ${path}`] = handler; },
  };
  return { router, routes };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  return res;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function importExtension() {
  return import('../src/index.js');
}

describe('gemini-proxy endpoint', () => {
  it('returns 503 when GEMINI_API_KEY is not configured', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: {}, logger: { warn: vi.fn(), error: vi.fn() } });

    const res = mockRes();
    await routes['POST /']({ body: { contents: [] } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 503 when explicitly disabled', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: { GEMINI_API_KEY: 'k', GEMINI_PROXY_ENABLED: 'false' }, logger: {} });

    const res = mockRes();
    await routes['POST /']({ body: { contents: [] } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it('returns 400 when contents is missing', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: { GEMINI_API_KEY: 'k' }, logger: {} });

    const res = mockRes();
    await routes['POST /']({ body: { contents: 'not-an-array' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('forwards the request to Gemini with the server-side key and returns the upstream JSON', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: { GEMINI_API_KEY: 'secret-key' }, logger: {} });

    const upstreamPayload = {
      candidates: [{ content: { parts: [{ text: 'Ti consiglio [ADD:primo_1].' }] } }],
    };
    globalThis.fetch = vi.fn(async (url, opts) => {
      // The key must be appended server-side, never sent by the client.
      expect(String(url)).toContain('key=secret-key');
      expect(String(url)).toContain('gemini-2.0-flash:generateContent');
      expect(opts.method).toBe('POST');
      const sent = JSON.parse(opts.body);
      expect(sent.contents).toHaveLength(1);
      expect(sent.systemInstruction).toBeDefined();
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(upstreamPayload),
      };
    });

    const res = mockRes();
    await routes['POST /']({
      body: {
        model: 'gemini-2.0-flash',
        contents: [{ parts: [{ text: 'consigliami un piatto' }] }],
        systemInstruction: { parts: [{ text: 'sys' }] },
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(upstreamPayload);
  });

  it('propagates upstream error status codes', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: { GEMINI_API_KEY: 'k' }, logger: { warn: vi.fn() } });

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'quota exceeded' } }),
    }));

    const res = mockRes();
    await routes['POST /']({ body: { contents: [{ parts: [{ text: 'hi' }] }] } }, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error.message).toMatch(/quota/);
  });

  it('does not throw and falls back to the default model when model is not a string', async () => {
    const { default: register } = await importExtension();
    const { router, routes } = createMockRouter();
    register(router, { env: { GEMINI_API_KEY: 'k' }, logger: {} });

    globalThis.fetch = vi.fn(async (url) => {
      // A non-string model must not crash the handler; default model is used.
      expect(String(url)).toContain('gemini-2.0-flash:generateContent');
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
    });

    const res = mockRes();
    await routes['POST /']({
      body: { model: { nested: 'object' }, contents: [{ parts: [{ text: 'hi' }] }] },
    }, res);
    expect(res.statusCode).toBe(200);
  });
});
