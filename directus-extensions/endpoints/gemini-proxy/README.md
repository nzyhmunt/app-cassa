# Gemini Proxy (Directus endpoint extension)

Server-side proxy for the Self-Order Chef Assistant. The customer-facing PWA never
holds the Gemini API key; instead it calls this endpoint, which injects the key
server-side before forwarding the request to Google.

## Why

`VITE_*` variables are embedded in the client bundle and publicly extractable.
Putting the Gemini key there (as the original implementation did) lets anyone
reuse it. This extension keeps the key on the Directus server.

## Env vars (Directus server)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | — | Gemini API key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | `gemini-2.0-flash` | Default model |
| `GEMINI_PROXY_ENABLED` | no | `true` | Set to `false` to disable |

## Install

Copy `directus-extensions/endpoints/gemini-proxy` into your Directus `extensions/`
folder, run `npm install && npm run build`, then restart Directus. The endpoint
becomes `POST /directus/gemini` (the `/directus` prefix is Directus's default).

The endpoint is subject to Directus's standard auth middleware; configure public
access via Directus Roles & Permissions if the self-order PWA must call it with a
limited/role token.
