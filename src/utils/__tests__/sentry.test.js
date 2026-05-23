import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted above all imports; both the static import below and the
// dynamic import('@sentry/vue') inside initSentry() will receive this mock.
vi.mock('@sentry/vue', () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn((options) => ({ type: 'browserTracing', options })),
  replayIntegration: vi.fn(() => ({ type: 'replay' })),
  feedbackIntegration: vi.fn((options) => ({ type: 'feedback', options })),
}));

import * as Sentry from '@sentry/vue';
import { initSentry, _resetSentryInitialized } from '../sentry.js';

describe('initSentry()', () => {
  const app = { config: {} };
  const router = { currentRoute: { value: '/' } };

  beforeEach(() => {
    _resetSentryInitialized();
    Sentry.init.mockClear();
    Sentry.browserTracingIntegration.mockClear();
    Sentry.replayIntegration.mockClear();
    Sentry.feedbackIntegration.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not call Sentry.init in non-PROD environments', async () => {
    await initSentry(app, router);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init once in a PROD environment with feedback fields optional', async () => {
    vi.stubEnv('PROD', true);

    await initSentry(app, router);

    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(Sentry.browserTracingIntegration).toHaveBeenCalledWith({ router });
    expect(Sentry.replayIntegration).toHaveBeenCalledOnce();
    expect(Sentry.feedbackIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        autoInject: true,
        triggerLabel: 'Segnala un problema',
        isNameRequired: false,
        isEmailRequired: false,
      }),
    );

    const [config] = Sentry.init.mock.calls[0];
    expect(config).toMatchObject({
      app,
      dsn: 'https://98c627313c1a5ce65e64d1e26209eed8@o4511441126359040.ingest.de.sentry.io/4511441143201872',
      sendDefaultPii: false,
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      enableLogs: true,
    });
    expect(config.tracePropagationTargets).toEqual(expect.arrayContaining(['localhost', window.location.origin]));
  });

  it('supports environment overrides for DSN, PII, and trace propagation targets', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_SEND_DEFAULT_PII', 'true');
    vi.stubEnv('VITE_SENTRY_TRACE_PROPAGATION_TARGETS', 'https://api.example.com, https://cdn.example.com');

    await initSentry(app, router);

    const [config] = Sentry.init.mock.calls[0];
    expect(config.dsn).toBe('https://examplePublicKey@o0.ingest.sentry.io/1');
    expect(config.sendDefaultPii).toBe(true);
    expect(config.tracePropagationTargets).toEqual(['https://api.example.com', 'https://cdn.example.com']);
  });

  it('calls Sentry.init exactly once even when initSentry() is called multiple times', async () => {
    vi.stubEnv('PROD', true);

    await initSentry(app, router);
    await initSentry(app, router);
    await initSentry(app, router);

    expect(Sentry.init).toHaveBeenCalledOnce();
  });

  it('does not call Sentry.init in non-browser contexts (SSR)', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('window', undefined);

    await initSentry(app, router);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not throw and allows retry when Sentry.init fails', async () => {
    vi.stubEnv('PROD', true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Sentry.init
      .mockImplementationOnce(() => {
        throw new Error('init failed');
      })
      .mockImplementationOnce(() => {});

    await expect(initSentry(app, router)).resolves.toBeUndefined();
    await initSentry(app, router);

    expect(Sentry.init).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
