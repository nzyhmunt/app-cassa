const LOG_ROCKET_APP_ID = 'raevtz/nanawork';

let _initialized = false;

/** Resets the initialization flag. Used only in tests. */
export function _resetLogRocketInitialized() {
  _initialized = false;
}

/**
 * Initializes LogRocket for production session recording.
 *
 * - Skips initialization in non-browser (SSR/test) contexts.
 * - Skips initialization outside of production builds so the LogRocket
 *   bundle is never evaluated in dev/test environments.
 * - Idempotent: safe to call multiple times; initializes only once.
 * - Applies sanitization rules to protect sensitive POS data (payment
 *   card inputs, PINs, authorization credentials).
 */
export async function initLogRocket() {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.PROD) return;
  if (_initialized) return;
  _initialized = true;

  try {
    const { default: LogRocket } = await import('logrocket');
    LogRocket.init(LOG_ROCKET_APP_ID, {
      network: {
        requestSanitizer(request) {
          // Redact authentication and session headers to prevent credential leakage.
          const headers = request?.headers;
          if (!headers || typeof headers !== 'object') {
            return request;
          }

          const sensitiveHeaders = new Set(['authorization', 'cookie']);
          for (const header of Object.keys(headers)) {
            if (sensitiveHeaders.has(header.toLowerCase())) {
              headers[header] = '[REDACTED]';
            }
          }
          return request;
        },
      },
      dom: {
        // Mask all input field values (payment card numbers, PINs, order notes).
        inputSanitizer: true,
      },
    });
  } catch (error) {
    _initialized = false;
    console.warn('[LogRocket] Initialization skipped:', error);
  }
}
