# AI concierge deployment and verification

The browser calls the Urban Blade backend. The NVIDIA credential belongs only
to the backend environment; it must never be placed in Angular environment files.
Local `server/.env` values are not automatically uploaded to Render.

For the existing Render API service, open Environment and configure:

- `NVIDIA_API_KEY`: the NVIDIA credential, entered privately in Render.
- `NVIDIA_MODEL`: `meta/llama-3.2-11b-vision-instruct` (or a model available to your account).
- `AI_ALLOW_PUBLIC_FALLBACK`: `false`.

Save and redeploy the backend. Render ignores new `sync: false` entries when
updating an existing Blueprint, so the manual secret entry is required.
See https://render.com/docs/blueprint-spec#prompting-for-secret-values.

After a chat request, an authenticated admin can GET `/api/support/ai-status`.
It reports configuration presence, model and last provider attempt without
returning the key. `not_configured` means missing key; `unauthorized` means
rejected credential; `model_unavailable` means model access or model ID failure;
`rate_limited` means provider quota/rate limits. `idle` means no provider attempt
has occurred in that process. This is process-local diagnostic state, not a
per-message result. Native Indian scripts currently use local language templates.

The bot can answer with local templates when the provider fails. A nonempty chat
reply therefore does not prove an online model is connected. Offline replies are
not cached, so configuration repairs can recover on the next request.

Provider-only smoke test (from `server/`, loads its `.env`):

```sh
npx tsx scripts/test-ai-online-api.ts
```

This makes one synthetic provider request without touching customer data or
printing credentials. Deterministic regression tests run with:

```sh
npm run server:build
node --test --test-concurrency=1 server/tests/*.test.mjs
```
