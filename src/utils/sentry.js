import * as Sentry from '@sentry/vue';

// The DSN is safe to expose in client-side code — Sentry DSNs are public by
// design. An environment variable override is supported for multi-environment
// setups (e.g. staging vs. production projects).
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ||
  'https://98c627313c1a5ce65e64d1e26209eed8@o4511441126359040.ingest.de.sentry.io/4511441143201872';

let _initialized = false;

/** Resets the initialization flag. Used only in tests. */
export function _resetSentryInitialized() {
  _initialized = false;
}

/**
 * Initializes Sentry for production error monitoring, session replay, and
 * distributed tracing.
 *
 * - Skips initialization in non-browser (SSR/test) contexts.
 * - Skips initialization outside of production builds so the Sentry
 *   bundle is never evaluated in dev/test environments.
 * - Idempotent: safe to call multiple times; initializes only once.
 *
 * @param {import('vue').App} app - The Vue application instance.
 * @param {import('vue-router').Router} router - The Vue Router instance used
 *   for browser tracing integration.
 */
export function initSentry(app, router) {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.PROD) return;
  if (_initialized) return;
  _initialized = true;

  Sentry.init({
    app,
    dsn: SENTRY_DSN,
    sendDefaultPii: true,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        // Italian labels for the feedback widget UI.
        buttonLabel: 'Segnala un problema',
        submitButtonLabel: 'Invia segnalazione',
        cancelButtonLabel: 'Annulla',
        formTitle: 'Segnala un problema',
        nameLabel: 'Nome',
        namePlaceholder: 'Il tuo nome',
        emailLabel: 'Email',
        emailPlaceholder: 'la.tua@email.it',
        messageLabel: 'Descrizione',
        messagePlaceholder: 'Descrivi il problema che hai riscontrato…',
        isRequiredLabel: '(obbligatorio)',
        successMessageText: 'Segnalazione inviata. Grazie!',
        // Show the widget as a floating button in the bottom-right corner.
        autoInject: true,
      }),
    ],
    // Tracing
    tracesSampleRate: 1.0,
    // TODO: replace the placeholder with your actual production API origin.
    tracePropagationTargets: ['localhost', /^https:\/\/yourserver\.io\/api/],
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Logs
    enableLogs: true,
  });
}
