import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted above all imports; both the static import below and the
// dynamic import('logrocket') inside initLogRocket() will receive this mock.
vi.mock('logrocket', () => ({
  default: { init: vi.fn() },
}));

import LogRocket from 'logrocket';
import { initLogRocket, _resetLogRocketInitialized } from '../logRocket.js';

// ---------------------------------------------------------------------------
// initLogRocket()
// ---------------------------------------------------------------------------

describe('initLogRocket()', () => {
  beforeEach(() => {
    // Reset the module-level initialization flag between tests.
    _resetLogRocketInitialized();
    // Reset the call record on the mocked init function.
    LogRocket.init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not call LogRocket.init in non-PROD environments', async () => {
    // import.meta.env.PROD is false by default in the Vitest test environment.
    await initLogRocket();
    expect(LogRocket.init).not.toHaveBeenCalled();
  });

  it('calls LogRocket.init once in a PROD environment', async () => {
    vi.stubEnv('PROD', true);
    await initLogRocket();
    expect(LogRocket.init).toHaveBeenCalledOnce();
    expect(LogRocket.init).toHaveBeenCalledWith('raevtz/nanawork', expect.any(Object));
  });

  it('passes a sanitization config to LogRocket.init in PROD', async () => {
    vi.stubEnv('PROD', true);
    await initLogRocket();
    const [, config] = LogRocket.init.mock.calls[0];
    expect(config).toMatchObject({
      dom: { inputSanitizer: true },
      network: { requestSanitizer: expect.any(Function) },
    });
  });

  it('calls LogRocket.init exactly once even when initLogRocket() is called multiple times', async () => {
    vi.stubEnv('PROD', true);
    await initLogRocket();
    await initLogRocket();
    await initLogRocket();
    expect(LogRocket.init).toHaveBeenCalledOnce();
  });

  it('does not call LogRocket.init in non-browser contexts (SSR)', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('window', undefined);
    await initLogRocket();
    expect(LogRocket.init).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requestSanitizer behavior
// ---------------------------------------------------------------------------

describe('requestSanitizer()', () => {
  beforeEach(() => {
    _resetLogRocketInitialized();
    LogRocket.init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Retrieve the requestSanitizer function that was passed to LogRocket.init. */
  async function getRequestSanitizer() {
    vi.stubEnv('PROD', true);
    await initLogRocket();
    const [, config] = LogRocket.init.mock.calls[0];
    return config.network.requestSanitizer;
  }

  it('redacts the Authorization header', async () => {
    const sanitize = await getRequestSanitizer();
    const req = { headers: { Authorization: 'Bearer secret-token' } };
    sanitize(req);
    expect(req.headers.Authorization).toBe('[REDACTED]');
  });

  it('redacts the authorization header (lowercase)', async () => {
    const sanitize = await getRequestSanitizer();
    const req = { headers: { authorization: 'Bearer secret-token' } };
    sanitize(req);
    expect(req.headers.authorization).toBe('[REDACTED]');
  });

  it('redacts the Cookie header', async () => {
    const sanitize = await getRequestSanitizer();
    const req = { headers: { Cookie: 'session=abc123' } };
    sanitize(req);
    expect(req.headers.Cookie).toBe('[REDACTED]');
  });

  it('leaves unrelated headers untouched', async () => {
    const sanitize = await getRequestSanitizer();
    const req = { headers: { 'Content-Type': 'application/json', 'X-Request-Id': '42' } };
    sanitize(req);
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['X-Request-Id']).toBe('42');
  });

  it('returns the request object', async () => {
    const sanitize = await getRequestSanitizer();
    const req = { headers: {} };
    expect(sanitize(req)).toBe(req);
  });
});
