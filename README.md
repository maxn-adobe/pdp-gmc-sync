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
5. **Confirm the PDP host allowlist** in
   [`config/defaults.json`](./config/defaults.json) still matches the two
   valid hosts (adobe.com production, aem.live preview). `google_product_category`
   is mandatory (see below) — populate [`config/category-map.json`](./config/category-map.json)
   for every `product_type` the DA tool can send, or the DA tool must supply
   `google_product_category` directly on rows whose `product_type` isn't mapped.

## Merchant API authentication

This service uses `express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com`
from GCP project `adbe-gcp1060`. Set `GMC_SERVICE_ACCOUNT_JSON` to that
account's complete JSON key, including `private_key`, and keep it only in
`.env` or the deployment secret store. Set `GMC_SERVICE_ACCOUNT_EMAIL` and
`GMC_GCP_PROJECT_ID` to the expected values so a key for another identity is
rejected before an API call.

After placing the unmodified GCP JSON key at `gmc-service-account.json`, run:

```bash
npm run check:gmc-auth
```

The check validates the key locally, obtains an access token without printing
it, and performs a read-only `products.list` request against test Merchant
account `5830778204`.

`GMC_MERCHANT_ACCOUNT_ID_{TEST|PROD}` identifies the Merchant Center account
to operate on. The GCP project ID is used during the one-time developer
registration and credential validation; it is not itself an API credential.
The confirmed test Merchant account ID is `5830778204`; the production account ID
remains a separate deployment value.

### Expected input row shape (from the DA tool)

Each object in the POST payload's `products` can have the following fields.:

| Field | Required | Notes |
| --- | --- | --- |
| `product_id` | ✓ | Zazzle URN (`urn:aaid:sc:...`) — colons are normalized to hyphens for the GMC `offerId`. |
| `title` | ✓ | Truncated to 150 chars. |
| `link` | ✓ | Full PDP URL. Must be HTTPS and its hostname must be in `pdpAllowedHosts`. |
| `initial_pretty_preferred_view_url` or `image_link` | ✓ | HTTPS image URL. |
| `price` | ✓ | Numeric or string (`"12.99"`, `"$12.99"`). Converted to integer micros. |
| `description` | ✓ | String; 5000 chars max. Hard-required by Google's product data spec — missing/empty is now a validation rejection, not a silent default. |
| `google_product_category` | ✓ (indirectly) | Mandatory — but resolved, not necessarily supplied directly. Provide `google_product_category` directly on the row **or** a `product_type` that has an entry in [`config/category-map.json`](./config/category-map.json). If neither resolves to a value, the row is rejected. An explicit `google_product_category` always wins over the `product_type` lookup. |
| `product_type` | required unless `google_product_category` is given directly | Raw Zazzle string (e.g. `zazzle_shirt`). Used for the category-map lookup — see `google_product_category` above. |
| `department_name` | optional | Zazzle department string (e.g. `"Men's T-Shirts"`). Drives the human-readable `productTypes` label, `"Print > " + department_name`. |
| `sale_price` | optional | Numeric advertised sale price. Only submitted when `sale_price_end_date` is still in the future at mapping time. |
| `sale_price_end_date` | optional | ISO datetime string — the raw Zazzle discount end date. Omit the row field entirely (rather than sending `null`) when there's no active discount. |
| `material`, `color`, `printing_type`, `size`, `age_group`, `gender`, `capacity` | optional | Variant attributes, product-type-conditional (e.g. a business card has none). Pass-through only. |
| `custom_label_0` | optional | Pass-through only — provenance still unconfirmed (business/reporting taxonomy). |
| `shipping_label` | optional | Pass-through only — no composition logic. |
| `minimum_order_quantity` | optional | Defaults to `1` (print-on-demand single unit) when the row omits it. |
| `brand`, `availability`, `condition`, `gtin`/`gtins` | optional | Row-level overrides — see [`config/defaults.json`](./config/defaults.json). |

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
  Chunks are capped at 50 products (Adobe I/O Runtime's 1MB payload limit).
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
    auth.js                         # validates service-account JSON and constructs GoogleAuth
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

## Open items (handoff §20)

Answered (wired into the code):

- ~~**§20 Q1** — Auth type~~ → service account
  `express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com` in project
  `adbe-gcp1060`; the JSON signing key still must be supplied as a secret.
- ~~**§20 Q2** — PDP canonical URL~~ → DA tool supplies a full `link`
  column; service validates against `pdpAllowedHosts` (adobe.com,
  aem.live preview).
- ~~**§20 Q3** — Price source~~ → DA tool will fetch price from Zazzle and
  add a `price` column to its export.
- ~~**§20 Q5** — Brand~~ → static `"Adobe Express"` for all products.
- ~~**§20 Q6** — Identifiers~~ → Zazzle URNs are not GTIN/MPN; the mapper
  sends `identifierExists: false` universally.

Still open (unblocks prod, no code work required yet):

- **§20 Q4** — Populate [`config/category-map.json`](./config/category-map.json)
  when a `product_type` → `googleProductCategory` mapping arrives. Keys
  are raw Zazzle strings (e.g. `zazzle_hoodie`).
- **§20 Q7** — Confirm a GMC test account exists (owner is checking).
- **§20 Q8** — Create the GCP project and complete `developerRegistration.registerGcp`
  against the Merchant Center account.
- **§20 Q9** — Stage/Prod workspace mapping (assumed: Stage → GMC test
  account, Prod → GMC prod account).
