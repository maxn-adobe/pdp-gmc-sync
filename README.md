# pdpgmcsync — GMC Feed Sync

Server-side Adobe I/O Runtime (App Builder) service that submits Adobe Express
Print product listings to Google Merchant Center via the **Merchant API v1
(stable)**. Headless — the browser (DA Document Generator) POSTs product rows
to these actions.

Authoritative spec: [`GMC-Feed-Sync-Handoff.md`](./GMC-Feed-Sync-Handoff.md).
Sections **§4 (corrections)** and **§15 (security)** are non-negotiable.

## Actions

| Action | Type | Purpose |
| --- | --- | --- |
| `sync-products` | web (`require-adobe-auth: true`) | Map export rows → v1 `productInputs.insert` via a bounded concurrent pool. Retry-once on 5xx/429. Returns per-item results — one failure never aborts the batch. |
| `diagnostics` | web (`require-adobe-auth: true`) | Called after a delay (Google processes inserts asynchronously — minutes). Reads processed status per offerId, or runs a `reports.search` sweep. Posts a digest to Slack + log. |
| `bootstrap-datasource` | admin (`web: no`) | One-off per environment. Creates a primary API data source and prints its ID. Store the ID in `.env` as `GMC_DATASOURCE_ID_{TEST\|PROD}`. |

Package name in the manifest: `gmc-feed-sync`. Runtime: `nodejs:22`. All web
actions are marked `final: true` so injected secrets cannot be overridden by
invocation params.

## Setup

1. **Install deps.** `npm install`.
2. **Populate `.env`** by copying `.env.example` and filling in real values.
   `.env` is gitignored. The Adobe I/O values (`AIO_runtime_*`) are already
   populated in this project — leave them.
3. **Confirm developer registration.** The GCP project backing the GMC
   credentials must be registered against the Merchant Center account
   (`developerRegistration.registerGcp`), otherwise every call fails with
   `AUTH_GCP_NOT_REGISTERED`. This is a one-time admin step (handoff §4).
4. **Create data sources.** Run `bootstrap-datasource` once for each
   environment; store the returned `dataSourceId` in `.env` as
   `GMC_DATASOURCE_ID_TEST` and `GMC_DATASOURCE_ID_PROD`.
5. **Fill the `_TODO_*` keys in [`config/defaults.json`](./config/defaults.json)**
   (PDP base URL, brand) and populate
   [`config/category-map.json`](./config/category-map.json) if you have a
   `product_type` → `googleProductCategory` mapping. See handoff §20 open
   questions.

## Local dev

- `aio app run` — local dev server; actions still deployed to Runtime.
- `aio app dev` — actions run locally; logs stream to the terminal.
- Direct invocation (deployed):
  ```bash
  aio runtime action invoke gmc-feed-sync/sync-products \
    --param env test --param-file ./sample-chunk.json --result
  ```
- Bootstrap:
  ```bash
  aio runtime action invoke gmc-feed-sync/bootstrap-datasource \
    --param env test --result
  ```
- Logs: `aio app logs --limit 20`, `aio runtime activation list`.

Deploys and pushes are performed by the repo owner — not by this tooling.

## Testing

- **Unit tests (no network):**
  ```bash
  npm test
  ```
  Covers `toMicros`, `mapProduct`, `validate`, `parseGoogleError`, `redact`,
  `runPool`, `insertWithRetry`, `resolveAccount/DataSource`, and the
  `sync-products` action's guards + happy path (Google clients mocked).
- **Integration tests (real Merchant API, test account only):** gated on
  `GMC_RUN_INTEGRATION=1`; see [`test/integration/README.md`](./test/integration/README.md).
  Skipped under `npm test`. Never point them at prod.

## Security posture (handoff §15)

- Secrets are read from action `params`, **never** `process.env` (handoff §7).
  Adobe I/O encrypts default params.
- Every log line goes through [`redact.js`](./actions/lib/redact.js) — GMC
  client secret, refresh token, service-account JSON, Slack webhook, and the
  Authorization header are replaced with `<hidden>`.
- All web actions are `require-adobe-auth: true` + `final: true`. Consider
  `disable-download: true` on production actions once stable (one-way).
- Incoming rows are allowlist-validated in [`validate.js`](./actions/lib/validate.js).
  Chunks are capped at 500 products.
- Outbound calls are HTTPS-only. `rejectUnauthorized: false` is banned.
- `.env`, `.aio`, `console.json`, `*service-account*.json`, `credentials.json`,
  `*.pem` are all gitignored.

## Layout

```
actions/
  sync-products/index.js
  diagnostics/index.js
  bootstrap-datasource/index.js
  utils.js                          # scaffold helpers (errorResponse, checkMissingRequestInputs, ...)
  lib/
    auth.js                         # OAuth2Client primary, GoogleAuth (SA) alt
    gmcClients.js                   # constructs v1 clients from auth
    config.js                       # env → account/data source resolution
    mapProduct.js                   # export row → v1 productInput (price → integer micros)
    validate.js                     # allowlist validation for incoming rows
    concurrency.js                  # bounded worker pool
    insertWithRetry.js              # single insert + retry-once on 5xx/429
    googleError.js                  # gax/gRPC + REST → { code, status, reason, retriable }
    diagnostics.js                  # products.get / reports.search → structured report
    slack.js                        # digest POST to webhook (HTTPS-only)
    redact.js                       # log-safe stringifier
config/
  defaults.json                     # brand, availability, condition, currency, feedLabel, contentLanguage, pdpBaseUrl (TODO)
  category-map.json                 # product_type → googleProductCategory (empty by default)
test/
  unit/                             # 100 tests; no network
  integration/                      # env-gated, test account only
```

## Open items (handoff §20 — need answers before prod)

- **§20 Q2** — PDP canonical URL pattern (`config/defaults.json.pdpBaseUrl`).
- **§20 Q3** — Which price column, and which quantity tier, feeds
  `productAttributes.price`? Currency handling beyond USD?
- **§20 Q4** — `product_type` → `googleProductCategory` map, or accept Google's
  auto-assignment?
- **§20 Q5** — Brand: constant `"Adobe Express"` or per-product/department?
- **§20 Q6** — Identifier strategy: is `identifierExists: false` correct for
  all Zazzle print items?
- **§20 Q1** — Confirm auth type when GMC provisions creds (OAuth vs service
  account — code supports both).
- **§20 Q7/Q9** — Chunk size (default 500), Stage/Prod workspace mapping.
