// The DSN is safe to expose in client-side code — Sentry DSNs are public by
// design. An environment variable override is supported for multi-environment
// setups (e.g. staging vs. production projects).
const DEFAULT_SENTRY_DSN =
  'https://98c627313c1a5ce65e64d1e26209eed8@o4511441126359040.ingest.de.sentry.io/4511441143201872';

let _initialized = false;

function getSentryDsn() {
  return import.meta.env.VITE_SENTRY_DSN || DEFAULT_SENTRY_DSN;
}

function isEnvFlagEnabled(value) {
  return value === 'true' || value === '1';
}

function getTracePropagationTargets() {
  const configuredTargets = import.meta.env.VITE_SENTRY_TRACE_PROPAGATION_TARGETS
    ?.split(',')
    .map((target) => target.trim())
    .filter(Boolean);

  if (configuredTargets?.length) {
    return configuredTargets;
  }

  const defaultTargets = ['localhost'];
  if (typeof window !== 'undefined' && window.location?.origin) {
    defaultTargets.push(window.location.origin);
  }
  return defaultTargets;
}

/** Resets the initialization flag. Used only in tests. */
export function _resetSentryInitialized() {
  _initialized = false;
}

/**
 * Initializes Sentry for production error monitoring, session replay, and
 * distributed tracing.
 *
 * - Skips initialization in non-browser (SSR/test) contexts.
 * - Lazily loads the Sentry bundle only in production browser builds.
 * - Idempotent: safe to call multiple times; initializes only once.
 *
 * @param {import('vue').App} app - The Vue application instance.
 * @param {import('vue-router').Router} router - The Vue Router instance used
 *   for browser tracing integration.
 */
export async function initSentry(app, router) {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.PROD) return;
  if (_initialized) return;

  try {
    const Sentry = await import('@sentry/vue');

    Sentry.init({
      app,
      dsn: getSentryDsn(),
      sendDefaultPii: isEnvFlagEnabled(import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII),
      integrations: [
        Sentry.browserTracingIntegration({ router }),
        Sentry.replayIntegration(),
        Sentry.feedbackIntegration({
          // Italian labels for the feedback widget UI.
          triggerLabel: 'Segnala un problema',
          triggerAriaLabel: 'Apri il modulo per segnalare un problema',
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
          isNameRequired: false,
          isEmailRequired: false,
          // Show the widget as a floating button in the bottom-right corner.
          autoInject: true,
        }),
      ],
      // Tracing
      tracesSampleRate: 1.0,
      tracePropagationTargets: getTracePropagationTargets(),
      // Session Replay
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Logs
      enableLogs: true,
    });

    _initialized = true;
  } catch (error) {
    _initialized = false;
    console.warn('[Sentry] Initialization skipped:', error);
  }
}
