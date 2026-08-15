/**
 * @file directus-extensions/endpoints/gemini-proxy/src/index.js
 * @description Directus endpoint extension — Gemini proxy per il Self-Order Chef Assistant.
 *
 * Espone `POST /gemini` (sotto l'API Directus, es. `/directus/gemini`) che riceve
 * il body della richiesta Gemini (`generateContent`) e lo inoltra all'API di Google
 * aggiungendo la chiave server-side. La chiave NON è mai esposta al client.
 *
 * Variabili d'ambiente (server Directus):
 *   GEMINI_API_KEY  — chiave API Gemini (obbligatoria per abilitare il proxy).
 *   GEMINI_MODEL    — modello di default (default: 'gemini-2.0-flash').
 *   GEMINI_PROXY_ENABLED — 'true'/'false' per disabilitare esplicitamente il proxy.
 *
 * Autenticazione: l'endpoint è protetto dal middleware di autenticazione Directus
 * standard (richiede un token Bearer valido con accesso pubblico configurato se
 * necessario), quindi il pubblico non può chiamarlo anonimamente.
 *
 * Corpo della richiesta (POST, JSON):
 *   {
 *     "model": "gemini-2.0-flash",          // opzionale, override del default
 *     "contents": [...],                     // payload Gemini generateContent
 *     "systemInstruction": {...}             // opzionale
 *   }
 *
 * Risposta: il JSON restituito da Gemini (generateContent) o un errore JSON.
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

export default (router, { env, logger }) => {
  router.post('/', async (req, res) => {
    const apiKey = env.GEMINI_API_KEY;
    const enabled = env.GEMINI_PROXY_ENABLED !== 'false';

    if (!enabled) {
      return res.status(503).json({ error: 'Gemini proxy is disabled' });
    }

    if (!apiKey) {
      return res.status(503).json({ error: 'Gemini API key not configured on the server' });
    }

    // `model` is user-controlled; coerce to a trimmed string so a non-string
    // body value (e.g. a number/object) can't throw on `.trim()` and turn a
    // bad request into a 500. Fall back to the configured/default model.
    const rawModel = req.body?.model;
    const model = (typeof rawModel === 'string' ? rawModel : (env.GEMINI_MODEL || DEFAULT_MODEL)).trim();
    const { contents, systemInstruction } = req.body || {};

    if (!Array.isArray(contents)) {
      return res.status(400).json({ error: 'Missing "contents" array in request body' });
    }

    const url = `${GEMINI_ENDPOINT}${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(systemInstruction ? { systemInstruction } : {}),
        }),
      });

      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }

      if (!upstream.ok) {
        logger?.warn?.(`[gemini-proxy] Upstream error ${upstream.status}`);
        return res.status(upstream.status).json(data);
      }

      return res.status(200).json(data);
    } catch (err) {
      logger?.error?.(`[gemini-proxy] Request failed: ${err?.message ?? err}`);
      return res.status(502).json({ error: 'Failed to reach Gemini API' });
    }
  });
};
