# Proposal final PDF worker

This Supabase Edge Function is the authenticated queue/coordination layer. It does
not render in Deno and never rasterizes the proposal. After returning HTTP 202 it
uses `EdgeRuntime.waitUntil` to call Browserless's server-side Chromium `/pdf`
endpoint, which performs Chrome Print-to-PDF from the saved proposal HTML and the
deployed application stylesheet. The function then uploads the resulting `%PDF-`
file to `proposal-final-pdfs` and updates the existing final-PDF columns.

Required function secrets:

- `BROWSERLESS_URL` — a Browserless deployment URL (self-hosted or managed).
- `BROWSERLESS_TOKEN` — its access token.
- `DASHBOARD_PUBLIC_BASE_URL` — deployed dashboard base URL, ending in `/`.
- `DASHBOARD_PROPOSAL_PRINT_CSS_URL` — optional explicit deployed Vite CSS URL;
  otherwise the current stylesheet URL is discovered from the deployed index.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied
by Supabase. Deploy with `supabase functions deploy proposal-final-pdf`. A failed
render leaves the proposal approved and records `failed` plus the error; invoking
the function again retries it. Concurrent/repeated requests are claimed once.
