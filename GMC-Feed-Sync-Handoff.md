# Handoff: GMC Feed Sync Service (Adobe Express Print PDPs → Google Merchant Center)

**Audience:** A Claude Code agent building this project from scratch.
**JIRA:** (Print PDPs) GMC Feed — Integrate Google Merchant Center API — Enable programmatic product submission.
**Author of this doc:** Planning agent (ADO). Companion doc: `Adobe-IO-Setup-Guide.md` (how to stand up the Adobe I/O project this code deploys to).

Read this whole document before writing code. Sections 4 (corrections) and 15 (security) are non-negotiable — several "obvious" implementations are wrong for this API and platform.

---

## 1. Purpose

Build a **server-side Node.js service, deployed as Adobe I/O Runtime (App Builder) web actions**, that programmatically submits Adobe Express Print product listings to Google Merchant Center (GMC) via the **Merchant API v1 (stable)**. It runs a "check first" validation pass against a GMC **test account**, then submits to production, and reports feed diagnostics (disapprovals, missing attributes, policy issues) to a log and Slack.

This is **not** part of the browser app. It is a separate deployable. See §2 for why and how they relate.

---

## 2. What you're building & how it relates to the DA Document Generator

There is an existing internal browser tool, the **DA Document Generator** (`da-document-generator`): a browser-only React app (React 19 + Vite + Tailwind, **no backend**) that bulk-generates Document Authoring (DA) pages from Zazzle print-product data. It pulls product data from the Zazzle partner API, lets authors override fields, and can **export the full product dataset (author overrides included) as CSV/XLSX**.

That browser app **cannot** talk to GMC directly: a browser bundle served from `da.live` is publicly readable, so it cannot hold Google credentials (violates JIRA req #8 and AC #4). Therefore GMC integration is a **separate server-side service** (this project).

**Relationship:**
- The DA tool remains the **data source** (its override-merged export) and the **trigger** (the browser calls this service's web action).
- This service is the only place that holds Google credentials and calls the Merchant API.
- The two run **concurrently**: page generation (DA tool) and product submission (this service) are independent.

**Data path (v1):** the DA tool's export rows → chunked HTTP POST → this service's `sync-products` web action → Merchant API v1 → later, `diagnostics` action reads processed status.

---

## 3. Architecture

On-demand, user-triggered. Two primary web actions plus a one-off bootstrap action.

```
┌─────────────────────────────┐
│ DA Document Generator (browser) │  (existing app; not built here)
│  - user exports override data   │
│  - user clicks "Sync to GMC"    │
└───────────────┬─────────────────┘
                │  HTTPS, chunked (~250–500 products/call, <1MB each)
                │  Authorization: <IMS user token>, x-gw-ims-org-id: <org>
                ▼
┌──────────────────────────────────────────────────────────┐
│ Adobe I/O Runtime (App Builder)  — THIS PROJECT            │
│                                                            │
│  sync-products (web action)                                │
│    env=test|prod → resolves account + data source          │
│    map rows → productAttributes → concurrent inserts        │
│    retry-once on 5xx/429 → per-item results                 │
│                                                            │
│  diagnostics (web action, called after a delay)            │
│    reports.search / products.get for submitted offerIds     │
│    → structured status report → Slack + log                 │
│                                                            │
│  bootstrap-datasource (one-off admin action)               │
│    create primary API data source in test & prod           │
│    → prints data source IDs to store in config             │
└───────────────────────────────┬──────────────────────────┘
                                 │  HTTPS (service-account credentials)
                                 ▼
                 ┌───────────────────────────────┐
                 │ Google Merchant API v1 (stable) │
                 │  merchantapi.googleapis.com     │
                 └───────────────────────────────┘
```

**"Check first" flow (satisfies the test-API requirement):**
1. Browser calls `sync-products` with `env: 'test'` for the batch (or a sample).
2. After a short delay, browser calls `diagnostics` with `env: 'test'`.
3. Review the report. If clean, browser calls `sync-products` with `env: 'prod'`.

**Why diagnostics is a separate, delayed action:** Google processes inserted products asynchronously (minutes). A `200` from insert means *accepted*, not *live/approved*. You cannot read meaningful status in the same call, and a blocking web action is capped at ~30–60s anyway (§7). Keep insert (fast) and diagnostics (delayed) separate.

---

## 4. NON-NEGOTIABLE corrections to the ticket

The ticket was written with legacy Content API assumptions. Do **not** implement these as written:

| Ticket says | Reality (Merchant API v1) | What to build |
|---|---|---|
| "Batch requests support up to 100 products per call" | **There is no batch/customBatch endpoint in v1.** | Submit products via **individual `productInputs.insert` calls run concurrently** (bounded worker pool). "Batch of N with per-item logging" = the pool collects per-item results; one failure never aborts the run. |
| "Local dev runs against sandbox" / "run full sync against sandbox" | **No legacy sandbox sub-account.** | Use **Test Accounts** (`accounts.createTestAccount`). Data submitted there never publishes to Search/Shopping. |
| "OAuth 2.0 credentials" | For an automated server-to-server feed, Google recommends a **service account**. OAuth user-consent is only needed to act on accounts you don't own. | Use the provisioned service account in project `adbe-gcp1060` (see §9). |
| (implied) price is a decimal string | **Price is `{ amountMicros, currencyCode }`; 1,000,000 micros = 1 unit.** | `$25.00` → `{ amountMicros: "25000000", currencyCode: "USD" }`. Convert with rounding (§11). |
| (implied) insert of an existing product errors | **Insert is an upsert** — inserting an existing `contentLanguage~feedLabel~offerId` replaces it. | Idempotent by design. Do not add "does it exist" pre-checks. |
| (implied) status strings are `approved`/`pending`/`disapproved` | Status enums are **UPPER_SNAKE_CASE** (e.g. `NOT_ELIGIBLE_OR_DISAPPROVED`). | Read enums from the client library, not hardcoded lowercase strings. |

**Two more v1 prerequisites the ticket omits:**
- **Developer registration is mandatory and new.** The GCP project must be registered against the Merchant Center account (`developerRegistration.registerGcp`) or all calls fail with `AUTH_GCP_NOT_REGISTERED`. This is an admin/setup step, not code — but the service should surface that error clearly if it occurs.
- **The `dataSource` query parameter is mandatory** on every write. There is no implicit single feed.

---

## 5. Tech stack & dependencies

- **Runtime:** Node.js. Deploy on `nodejs:22` (Adobe I/O Runtime supports 18/20/22; 18 is EOL — use 22, or the latest Runtime-supported version; verify at deploy time).
- **Google client libraries** (modular `@google-shopping/*`, GAPIC-generated; follow Node LTS):
  - `@google-shopping/products` — `ProductInputsServiceClient` (`insertProductInput`, `deleteProductInput`), `ProductsServiceClient` (`getProduct`, `listProducts`). Exposes `Availability`, `Condition` enums and the `Price` type.
  - `@google-shopping/datasources` — `DataSourcesServiceClient`.
  - `@google-shopping/reports` — `ReportServiceClient.search` (marked preview; pin the version).
  - `@google-shopping/accounts` — test account + developer registration ops.
  - (optional) `@google-shopping/quota` — quota checks.
- `google-auth-library` — builds the service-account credential passed to the clients.
- `@adobe/aio-sdk` — `Core.Logger` for structured logging (already present in an App Builder scaffold).
- Dev: `jest` (or the scaffold's default test runner), `dotenv` is **not** needed at runtime (see §7 gotcha).

> The installed GAPIC clients accept the service-account `GoogleAuth` instance through `{ auth }`.

---

## 6. Repo structure

Recommend a **dedicated repo / App Builder project** (this is an Adobe I/O app; the DA tool is a browser app — keep them separate). Proposed layout:

```
gmc-feed-sync/
  app.config.yaml            # Adobe I/O manifest (see §8)
  package.json
  .env                       # gitignored — real secret values (never committed)
  .env.example               # committed — placeholder keys only
  .aio                       # gitignored — CLI/workspace state
  .gitignore                 # must include .env, .aio, console.json, *.json creds
  README.md
  config/
    defaults.json            # brand, availability, condition, currency, feedLabel, contentLanguage, PDP base URL
    category-map.json        # product_type → googleProductCategory
  actions/
    sync-products/index.js   # web action: map + concurrent insert + per-item results
    diagnostics/index.js     # web action: read processed status + issues → Slack/log
    bootstrap-datasource/index.js  # one-off: create primary data source, print IDs
    utils.js                 # scaffold-provided: errorResponse, checkMissingRequestInputs, getBearerToken, stringParameters
    lib/
      auth.js                # validate service-account JSON and construct GoogleAuth
      gmcClients.js          # constructs @google-shopping clients from auth
      config.js              # resolve env→account/dataSource; load defaults + category map
      mapProduct.js          # export row → productInput; price→micros; defaults; validation
      insertWithRetry.js     # single insert + retry-once + backoff
      concurrency.js         # bounded worker pool
      googleError.js         # parse google.rpc.Status / gax error → {code,status,reason,message,retriable}
      diagnostics.js         # reports.search / products.get → structured report
      slack.js               # post digest to webhook
      redact.js              # log-safe stringifier (extends stringParameters)
      validate.js            # allowlist input validation for incoming rows
  test/
    unit/                    # mapProduct, price conversion, chunking, error parsing, redaction
    integration/             # runs against the TEST account only
```

---

## 7. Configuration & secrets

### Environment variable schema (placeholders — fill from GMC + Adobe setup)

Put these in `.env` (gitignored) and mirror the keys (values blank) in `.env.example`:

```
# ---- Google Merchant Center service-account credentials ----
GMC_SERVICE_ACCOUNT_JSON=__COMPLETE_ONE_LINE_JSON_KEY__
GMC_SERVICE_ACCOUNT_EMAIL=express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com
GMC_GCP_PROJECT_ID=adbe-gcp1060

# ---- GMC account + data source IDs (test vs prod) ----
GMC_MERCHANT_ACCOUNT_ID_TEST=582778
GMC_MERCHANT_ACCOUNT_ID_PROD=__PLACEHOLDER__
GMC_DATASOURCE_ID_TEST=__PLACEHOLDER__     # filled after running bootstrap-datasource
GMC_DATASOURCE_ID_PROD=__PLACEHOLDER__

# ---- Ops ----
SLACK_WEBHOOK_URL=__PLACEHOLDER__
LOG_LEVEL=info

# ---- Adobe I/O Runtime (auto-populated by `aio app init`) ----
# AIO_runtime_namespace=...
# AIO_runtime_auth=...
```

### CRITICAL Adobe I/O gotcha: read secrets from `params`, not `process.env`

Adobe I/O Runtime does **not** guarantee `.env`/`process.env` values are present at runtime in the deployed environment. The `.env` values must be wired into the manifest as **action `inputs`** (default parameters), and the action reads them from its `params` argument:

```js
// CORRECT — inside actions/*/index.js
async function main (params) {
  const serviceAccountJson = params.GMC_SERVICE_ACCOUNT_JSON // manifest input → .env
}

// WRONG — will be undefined when deployed
const serviceAccountJson = process.env.GMC_SERVICE_ACCOUNT_JSON
```

Default parameters are **encrypted** by Adobe. Mark the actions `final: true` (§8) so a caller cannot override the injected secrets via invocation params. See §8 for how `$VAR` in the manifest pulls from `.env`, and how CI sets these for production (GitHub Actions secrets).

---

## 8. `app.config.yaml` (the Adobe I/O configuration)

Full manifest. `$GMC_SERVICE_ACCOUNT_JSON` etc. resolve from `.env` at deploy time and are injected as encrypted default params.

```yaml
application:
  runtimeManifest:
    packages:
      gmc-feed-sync:
        license: Apache-2.0
        actions:

          sync-products:
            function: actions/sync-products/index.js
            web: 'yes'
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: $LOG_LEVEL
              GMC_SERVICE_ACCOUNT_JSON: $GMC_SERVICE_ACCOUNT_JSON
              GMC_SERVICE_ACCOUNT_EMAIL: $GMC_SERVICE_ACCOUNT_EMAIL
              GMC_GCP_PROJECT_ID: $GMC_GCP_PROJECT_ID
              GMC_MERCHANT_ACCOUNT_ID_TEST: $GMC_MERCHANT_ACCOUNT_ID_TEST
              GMC_MERCHANT_ACCOUNT_ID_PROD: $GMC_MERCHANT_ACCOUNT_ID_PROD
              GMC_DATASOURCE_ID_TEST: $GMC_DATASOURCE_ID_TEST
              GMC_DATASOURCE_ID_PROD: $GMC_DATASOURCE_ID_PROD
            annotations:
              require-adobe-auth: true    # caller must present a valid IMS token
              final: true                 # lock injected params (secrets can't be overridden)
            limits:
              timeout: 60000              # ms (blocking web action ceiling; keep chunks small)
              memorySize: 512
              concurrency: 1

          diagnostics:
            function: actions/diagnostics/index.js
            web: 'yes'
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: $LOG_LEVEL
              GMC_SERVICE_ACCOUNT_JSON: $GMC_SERVICE_ACCOUNT_JSON
              GMC_SERVICE_ACCOUNT_EMAIL: $GMC_SERVICE_ACCOUNT_EMAIL
              GMC_GCP_PROJECT_ID: $GMC_GCP_PROJECT_ID
              GMC_MERCHANT_ACCOUNT_ID_TEST: $GMC_MERCHANT_ACCOUNT_ID_TEST
              GMC_MERCHANT_ACCOUNT_ID_PROD: $GMC_MERCHANT_ACCOUNT_ID_PROD
              GMC_DATASOURCE_ID_TEST: $GMC_DATASOURCE_ID_TEST
              GMC_DATASOURCE_ID_PROD: $GMC_DATASOURCE_ID_PROD
              SLACK_WEBHOOK_URL: $SLACK_WEBHOOK_URL
            annotations:
              require-adobe-auth: true
              final: true
            limits:
              timeout: 60000
              memorySize: 512
              concurrency: 1

          bootstrap-datasource:
            function: actions/bootstrap-datasource/index.js
            web: 'no'                     # admin-only; invoke via aio CLI, not the browser
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: $LOG_LEVEL
              GMC_SERVICE_ACCOUNT_JSON: $GMC_SERVICE_ACCOUNT_JSON
              GMC_SERVICE_ACCOUNT_EMAIL: $GMC_SERVICE_ACCOUNT_EMAIL
              GMC_GCP_PROJECT_ID: $GMC_GCP_PROJECT_ID
              GMC_MERCHANT_ACCOUNT_ID_TEST: $GMC_MERCHANT_ACCOUNT_ID_TEST
              GMC_MERCHANT_ACCOUNT_ID_PROD: $GMC_MERCHANT_ACCOUNT_ID_PROD
            annotations:
              require-adobe-auth: true
              final: true
```

Notes:
- `require-adobe-auth: true` means the browser must send `Authorization: <IMS token>` and `x-gw-ims-org-id: <org>` headers. The DA tool runs in the DA/Experience Cloud shell where an IMS token is available — pass it through. This keeps the web actions from being open to the world.
- Consider `disable-download: true` on the production actions to prevent downloading bundled code — **one-way switch**, so only set it once the build is stable.
- **Stage vs Prod workspaces** should carry different `.env` values (different GMC accounts/data sources). See the setup guide.

---

## 9. Auth module (`actions/lib/auth.js`)

The service uses only the provisioned service account. `GMC_SERVICE_ACCOUNT_JSON` must be the complete JSON key, including `private_key`; the email and project ID alone cannot sign an access-token request.

```js
const { GoogleAuth } = require('google-auth-library')

const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'

/**
 * Returns a Google auth client to pass to the @google-shopping clients.
 * Reads credentials from action params (NOT process.env — see handoff §7).
 */
function getAuthClient (params) {
  if (!params.GMC_SERVICE_ACCOUNT_JSON) {
    throw new Error('GMC credentials not configured: need GMC_SERVICE_ACCOUNT_JSON')
  }
  const credentials = JSON.parse(params.GMC_SERVICE_ACCOUNT_JSON)
  return new GoogleAuth({ credentials, scopes: [CONTENT_SCOPE] })
}

module.exports = { getAuthClient, CONTENT_SCOPE }
```

`actions/lib/gmcClients.js` constructs the service clients from this auth (verify the option key against the installed version — likely `auth`):

```js
const { ProductInputsServiceClient, ProductsServiceClient } = require('@google-shopping/products').v1
const { DataSourcesServiceClient } = require('@google-shopping/datasources').v1
const { ReportServiceClient } = require('@google-shopping/reports').v1beta // verify version/namespace
const { getAuthClient } = require('./auth')

function makeClients (params) {
  const auth = getAuthClient(params)
  return {
    productInputs: new ProductInputsServiceClient({ auth }),
    products: new ProductsServiceClient({ auth }),
    dataSources: new DataSourcesServiceClient({ auth }),
    reports: new ReportServiceClient({ auth })
  }
}
module.exports = { makeClients }
```

---

## 10. Data source bootstrap (`actions/bootstrap-datasource/index.js`)

Run **once per environment**. Creates a primary API data source and prints its ID. Store the printed IDs into `.env` (`GMC_DATASOURCE_ID_TEST` / `_PROD`). Data source IDs are **stable and reusable** — never create one per sync.

Contract: invoke via CLI, e.g. `aio runtime action invoke gmc-feed-sync/bootstrap-datasource --param env test --result`.

Skeleton:
```js
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount } = require('../lib/config')
const { Core } = require('@adobe/aio-sdk')

async function main (params) {
  const logger = Core.Logger('bootstrap-datasource', { level: params.LOG_LEVEL || 'info' })
  const accountId = resolveAccount(params, params.env)   // 'test' | 'prod'
  const { dataSources } = makeClients(params)

  const [ds] = await dataSources.createDataSource({
    parent: `accounts/${accountId}`,
    dataSource: {
      displayName: `Adobe Express Print Primary Feed (${String(params.env).toUpperCase()})`,
      primaryProductDataSource: {
        contentLanguage: 'en',
        feedLabel: 'US',
        countries: ['US']
      }
    }
  })
  // ds.name === accounts/{account}/dataSources/{DATASOURCE_ID}
  logger.info(`Created data source: ${ds.name}`)
  return { statusCode: 200, body: { name: ds.name, dataSourceId: ds.name.split('/').pop() } }
}
module.exports.main = main
```

> Verify method name (`createDataSource`) and request shape against the installed `@google-shopping/datasources`. For the multi-locale future, an alternative is a label-agnostic source (`primaryProductDataSource: {}`) that accepts any feedLabel/contentLanguage per product.

---

## 11. Product field mapping (`actions/lib/mapProduct.js`)

### Mapping table (DA export row → Merchant API v1)

| Merchant API field | Source | Notes / default |
|---|---|---|
| `offerId` (top-level) | export `product_id` | Sanitize to alphanumeric; this is the Zazzle template id. Keep clean to avoid Base64URL name-encoding. |
| `contentLanguage` (top-level) | constant | `'en'` (v1 scope) |
| `feedLabel` (top-level) | constant | `'US'` (v1 scope) |
| `productAttributes.title` | export `title` | Truncate to 150 chars if longer. |
| `productAttributes.description` | export `description` | |
| `productAttributes.link` | **composed** | `defaults.pdpBaseUrl` + `url_slug` — must be the canonical **public** PDP URL. **CONFIRM the base URL pattern** (see §20). |
| `productAttributes.imageLink` | export `initial_pretty_preferred_view_url` | |
| `productAttributes.price` | **GAP** | `{ amountMicros, currencyCode: 'USD' }`. Source = `price` column if present, else Zazzle base/min-quantity price. **CONFIRM source + quantity tier** (§20). |
| `productAttributes.availability` | default | `'IN_STOCK'` (print-on-demand); overridable via `availability` column. |
| `productAttributes.condition` | default | `'NEW'`. |
| `productAttributes.brand` | `defaults.brand` | e.g. `'Adobe Express'` — **CONFIRM** (§20). Overridable via `brand` column. |
| `productAttributes.gtins` | export `gtin`/`gtins` if present | Print-on-demand custom goods usually have none. |
| `productAttributes.identifierExists` | default | `false` when no GTIN/MPN (correct for custom print products). Set `true` only if real identifiers exist. |
| `productAttributes.googleProductCategory` | `category-map.json[product_type]` | Omit if unmapped (Google auto-assigns). **PROVIDE the map or accept auto-assign for v1** (§20). |

### Price conversion (the migration trap — must be integer micros)

```js
/** "12.99" | "$12.99" | 12.99 → { amountMicros: "12990000", currencyCode } */
function toMicros (priceValue, currencyCode = 'USD') {
  const num = typeof priceValue === 'number'
    ? priceValue
    : parseFloat(String(priceValue).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(num) || num < 0) throw new Error(`Invalid price: ${priceValue}`)
  return { amountMicros: String(Math.round(num * 1_000_000)), currencyCode }
}
```

### Mapper

```js
const defaults = require('../../config/defaults.json')
const categoryMap = require('../../config/category-map.json')

function sanitizeOfferId (id) {
  return String(id || '').trim()   // keep alphanumeric; reject empties in validate.js
}

function mapProduct (row) {
  const offerId = sanitizeOfferId(row.product_id)
  const attrs = {
    title: String(row.title || '').slice(0, 150),
    description: row.description || '',
    link: defaults.pdpBaseUrl.replace(/\/$/, '') + '/' + String(row.url_slug || '').replace(/^\//, ''),
    imageLink: row.initial_pretty_preferred_view_url || row.image_link,
    availability: (row.availability || defaults.availability || 'IN_STOCK'),
    condition: (row.condition || defaults.condition || 'NEW'),
    brand: row.brand || defaults.brand,
    price: toMicros(row.price ?? row.base_price, defaults.currency || 'USD')
  }
  const gpc = categoryMap[row.product_type]
  if (gpc) attrs.googleProductCategory = gpc

  if (row.gtin || row.gtins) {
    attrs.gtins = Array.isArray(row.gtins) ? row.gtins : [row.gtin]
  } else {
    attrs.identifierExists = false
  }

  return {
    offerId,
    contentLanguage: 'en',
    feedLabel: 'US',
    productAttributes: attrs
  }
}
module.exports = { mapProduct, toMicros }
```

`config/defaults.json` example:
```json
{
  "pdpBaseUrl": "https://www.adobe.com/express/CONFIRM-PATH",
  "brand": "Adobe Express",
  "availability": "IN_STOCK",
  "condition": "NEW",
  "currency": "USD",
  "feedLabel": "US",
  "contentLanguage": "en"
}
```

---

## 12. `sync-products` action

**Request body** (`params` beyond injected secrets):
```json
{ "env": "test", "products": [ { "product_id": "...", "title": "...", "...": "..." } ] }
```
- `env`: `"test"` | `"prod"` → selects account + data source via `config.js`.
- `products`: array of export rows. **Cap ~250–500 per call** to stay under the 1 MB inline limit and 60s blocking ceiling. The browser chunks a 1000–5000 batch into multiple calls and aggregates results.

**Response:**
```json
{ "submitted": 500, "succeeded": 497, "failed": 3,
  "results": [ { "offerId": "abc", "ok": true, "name": "accounts/.../productInputs/en~US~abc" },
               { "offerId": "xyz", "ok": false, "code": 400, "status": "INVALID_ARGUMENT",
                 "reason": "invalid_attribute", "message": "..." } ] }
```

Handler skeleton:
```js
const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount, resolveDataSource } = require('../lib/config')
const { mapProduct } = require('../lib/mapProduct')
const { validateRows } = require('../lib/validate')
const { insertWithRetry } = require('../lib/insertWithRetry')
const { runPool } = require('../lib/concurrency')
const { redact } = require('../lib/redact')
const { errorResponse, checkMissingRequestInputs } = require('../utils')

async function main (params) {
  const logger = Core.Logger('sync-products', { level: params.LOG_LEVEL || 'info' })
  logger.debug(redact(params))                        // NEVER log raw params (secrets)

  const missing = checkMissingRequestInputs(params, ['env', 'products'], ['Authorization'])
  if (missing) return errorResponse(400, missing, logger)
  if (!Array.isArray(params.products) || params.products.length === 0) {
    return errorResponse(400, 'products must be a non-empty array', logger)
  }
  if (params.products.length > 500) {
    return errorResponse(400, 'chunk too large; send <= 500 products per call', logger)
  }

  const accountId = resolveAccount(params, params.env)
  const dataSource = resolveDataSource(params, params.env, accountId)
  const { productInputs } = makeClients(params)

  const { valid, invalid } = validateRows(params.products) // reject rows missing required fields up front

  const results = await runPool(valid, async (row) => {
    let input
    try { input = mapProduct(row) }
    catch (e) { return { offerId: row.product_id, ok: false, status: 'MAP_ERROR', message: e.message } }
    return insertWithRetry(productInputs, {
      parent: `accounts/${accountId}`,
      dataSource,
      productInput: input
    }, input.offerId, logger)
  }, 15)                                                // start at concurrency 15; tune vs quota

  const all = [...results, ...invalid.map(v => ({ offerId: v.product_id, ok: false, status: 'VALIDATION_ERROR', message: v.reason }))]
  const succeeded = all.filter(r => r.ok).length
  return {
    statusCode: 200,
    body: { submitted: params.products.length, succeeded, failed: all.length - succeeded, results: all }
  }
}
module.exports.main = main
```

`actions/lib/concurrency.js`:
```js
async function runPool (items, worker, concurrency = 15) {
  const results = new Array(items.length)
  let idx = 0
  async function next () {
    while (idx < items.length) { const i = idx++; results[i] = await worker(items[i], i) }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  return results
}
module.exports = { runPool }
```

`actions/lib/insertWithRetry.js`:
```js
const { parseGoogleError } = require('./googleError')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const jitter = (min, max) => Math.floor(min + Math.random() * (max - min))

async function insertWithRetry (client, req, offerId, logger) {
  try {
    const [resp] = await client.insertProductInput(req)
    return { offerId, ok: true, name: resp.name }
  } catch (err) {
    const p = parseGoogleError(err)
    if (p.retriable) {                                  // 5xx / 429 / transient only
      await sleep(jitter(500, 1500))
      try {
        const [resp] = await client.insertProductInput(req)
        return { offerId, ok: true, name: resp.name, retried: true }
      } catch (err2) {
        const p2 = parseGoogleError(err2)
        logger.error(`insert failed offerId=${offerId} code=${p2.code} status=${p2.status} reason=${p2.reason}`)
        return { offerId, ok: false, code: p2.code, status: p2.status, reason: p2.reason, message: p2.message }
      }
    }
    logger.error(`insert failed offerId=${offerId} code=${p.code} status=${p.status} reason=${p.reason}`)
    return { offerId, ok: false, code: p.code, status: p.status, reason: p.reason, message: p.message }
  }
}
module.exports = { insertWithRetry }
```

---

## 13. `diagnostics` action

**Request body:** `{ "env": "test", "offerIds": ["abc", "xyz"] }` (or omit `offerIds` to report the whole data source via `reports.search`).

**Behavior:**
1. Wait for processing before calling (the browser should delay, e.g. a few minutes after the last insert).
2. For each offerId, read the processed `Product` (`products.get` at `accounts/{account}/products/en~US~{offerId}`) OR run one `reports.search` over `product_view`.
3. Extract per-product `destinationStatuses` and `itemLevelIssues` (`code`, `severity`, `resolution`, `attribute`, `description`, `documentation`).
4. Build a structured report: counts by status (`active` / `pending` / `disapproved`), plus per-product issues.
5. Post a digest to Slack and the log. Return the report.

`reports.search` query for a whole-feed disapproval sweep:
```sql
SELECT offer_id, id, title, price, item_issues
FROM product_view
WHERE aggregated_reporting_context_status = 'NOT_ELIGIBLE_OR_DISAPPROVED'
```

`actions/lib/slack.js` posts `{ text: <digest> }` to `params.SLACK_WEBHOOK_URL` via HTTPS POST. Never include credentials in the message.

> Verify `reports.search` request shape and the `Product.productStatus` field path against the installed clients. Status enums are UPPER_SNAKE_CASE.

---

## 14. Error handling (`actions/lib/googleError.js`)

Parse the error into stable fields. GAPIC (google-gax) clients throw gRPC-coded errors; REST transport throws HTTP-coded errors. Handle both; **never branch on `message`** (unstable) — branch on code/status/reason.

```js
// gRPC status codes → retriability + a coarse HTTP-ish label
const GRPC = {
  0: 'OK', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND',
  7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 13: 'INTERNAL',
  14: 'UNAVAILABLE', 16: 'UNAUTHENTICATED'
}
const RETRIABLE_STATUS = new Set(['DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE'])

function parseGoogleError (err) {
  // REST style
  if (err && err.response && err.response.status) {
    const http = err.response.status
    const status = err.response.data?.error?.status || ''
    const reason = err.response.data?.error?.details?.[0]?.reason
                || err.response.data?.error?.details?.[0]?.metadata?.REASON || ''
    return { code: http, status, reason, message: err.message, retriable: http === 429 || http >= 500 }
  }
  // gax/gRPC style
  const status = GRPC[err?.code] || String(err?.code ?? 'UNKNOWN')
  const reason = err?.statusDetails?.find?.(d => d?.reason)?.reason
              || err?.errorInfoMetadata?.REASON || ''
  return { code: err?.code, status, reason, message: err?.message, retriable: RETRIABLE_STATUS.has(status) }
}
module.exports = { parseGoogleError }
```

**Policy (satisfies JIRA req #7):** catch every insert error; log with offerId + code + status + reason; **retry once** on 5xx/429/transient only; never retry 4xx; fail gracefully (record and continue — one failure never aborts the batch). No silent failures — every failed item appears in the results with a reason. If `RESOURCE_EXHAUSTED`/`request_rate_too_high` recurs, lower pool concurrency.

---

## 15. Security requirements (mandatory — Adobe security foundations)

These are enforced by Adobe's security tooling; the Claude Code agent must satisfy them and the repo should pass `adobe-security-audit` before deploy.

- **No hardcoded credentials (Rule A).** Zero secrets in source. All creds come from `.env` → manifest `inputs` → `params`. Add `.env`, `.aio`, `console.json`, and any `*service-account*.json` to `.gitignore`. Treat the repo as public.
- **Read secrets from `params`, never `process.env`** (also correctness — §7).
- **TLS only (Rule B/step 4).** All outbound calls are HTTPS (Google clients + Slack). Never disable certificate verification (`rejectUnauthorized: false` is banned).
- **Validate all external input.** Incoming rows come from a browser and are untrusted. In `validate.js`, allowlist required fields (`product_id`, `title`, `description`, image, `price`), enforce types/lengths, reject rather than coerce garbage. Cap `products.length` (≤500). Validate `env` against `{'test','prod'}`.
- **No sensitive data in logs.** Use `redact.js` (extend the scaffold's `stringParameters`, which already hides the `Authorization` header) to also strip `GMC_SERVICE_ACCOUNT_JSON` and any access token. Do not log full product payloads if they could carry PII. Log offerId + error codes, not raw bodies.
- **Fail securely / fail closed.** On auth/config errors, return a generic error and stop — never proceed unauthenticated. Generic messages to the caller; detailed (non-secret) context to the server log.
- **Least privilege.** Scope the service account to `content` only. QA uses a credential scoped to the **test account** only (§16) — never hand production credentials to QA.
- **Protect the deployed action.** `require-adobe-auth: true` (caller needs a valid IMS token) and `final: true` (secrets can't be overridden by invocation params). Consider `disable-download: true` on production actions once stable (irreversible).
- **Escalate** to the security team before go-live if the export ever carries regulated/PII data.

`actions/lib/redact.js` sketch:
```js
const SECRET_KEYS = ['GMC_SERVICE_ACCOUNT_JSON', 'authorization']
function redact (params) {
  const clone = { ...params }
  for (const k of Object.keys(clone)) {
    if (SECRET_KEYS.some(s => k.toLowerCase() === s.toLowerCase())) clone[k] = '<hidden>'
  }
  if (clone.__ow_headers?.authorization) {
    clone.__ow_headers = { ...clone.__ow_headers, authorization: '<hidden>' }
  }
  return JSON.stringify(clone)
}
module.exports = { redact }
```

---

## 16. Test mode / QA flow

- **Create a GMC test account once** (admin): `accounts.createTestAccount` (via `@google-shopping/accounts`, or a small script). Add the service account to it. Store its ID as `GMC_MERCHANT_ACCOUNT_ID_TEST`. Run `bootstrap-datasource --param env test` to create its data source.
- **Constraints:** max 5 test accounts per Google account; test accounts behave like production for uploads but **never publish**; cannot get quota increases; may eventually be suspended for invalid products (expected, harmless for API testing).
- **QA runs a full sync with no production creds:** give QA a credential (or a `.env`) that only targets the test account. `sync-products --param env test` then `diagnostics --param env test`. This satisfies AC #5.
- **"Check first" is the same code path** with `env: 'test'`.

---

## 17. Local dev & testing

- `.env` holds real (test) values locally. `aio app run` (local, gives a `https://localhost:9080`-style URL) or `aio app dev` (logs stream to terminal). `aio app deploy` gives the deployed web action URL the browser will call.
- Invoke directly: `aio runtime action invoke gmc-feed-sync/sync-products --param env test --param-file ./sample-chunk.json --result`.
- Logs: `aio app logs --limit 20`, or `aio runtime activation list` / `aio runtime activation get <id>`.
- **Unit tests** (no network): `toMicros` (rounding, `$`/string/number inputs, negatives throw), `mapProduct` (defaults, identifierExists, category map, link composition, title truncation), `parseGoogleError` (gax + REST, retriable classification), `redact` (secrets hidden), chunk-size guard.
- **Integration tests** (test account only): bootstrap → insert a known-good product → poll `products.get` until processed → assert status → clean up. Never point integration tests at prod.

---

## 18. Acceptance criteria (corrected from the ticket)

1. A valid PDP payload insert returns success from `productInputs.insert`; the product appears in the (test or prod) Merchant Center account after processing (minutes, not synchronous).
2. A batch of N products (e.g. 50, and up to a 5000 batch via chunking) submits with **per-item** success/failure results; failures are logged individually and never abort the batch.
3. `diagnostics` returns structured per-product status (active / pending / disapproved) with item-level issues, and posts a digest to Slack + log.
4. Missing/invalid credentials produce a clear, generic error; no hardcoded secrets anywhere; `.env`/creds gitignored.
5. A QA engineer runs a full sync against the **test account** with no production credentials.
6. `sync-products` is idempotent (re-running replaces, does not duplicate).
7. No batch/customBatch endpoint is used; submission is concurrent single inserts.
8. Repo passes `adobe-security-audit`.

---

## 19. Suggested build order for the Claude Code agent

1. Scaffold the App Builder app (see `Adobe-IO-Setup-Guide.md`), then replace the generated manifest with §8 and add deps from §5.
2. `lib/auth.js` + `lib/gmcClients.js` + `lib/config.js`. Prove auth with a trivial `products.list` against the test account.
3. `bootstrap-datasource` → create test data source → store its ID.
4. `lib/mapProduct.js` + `toMicros` + `config/defaults.json` + `config/category-map.json` (with the confirmed values from §20). Unit-test the mapper.
5. `lib/googleError.js`, `lib/insertWithRetry.js`, `lib/concurrency.js`, `lib/validate.js`, `lib/redact.js`.
6. `sync-products` action end-to-end against the test account.
7. `diagnostics` action + `lib/slack.js`.
8. Security pass (`adobe-security-audit`), unit + integration tests, README.
9. Deploy to the Stage workspace; wire the browser to call the deployed URL; run the full "check first → prod" flow.
10. Production: swap in prod `.env` (via CI secrets), request GMC item-quota increase if catalog > 150,000 (§20).

---

## 20. Open questions / assumptions to confirm (do not block scaffolding on these)

1. **Auth credential type (resolved):** service account `express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com` in GCP project `adbe-gcp1060`. Supply its complete JSON key through the deployment secret store.
2. **PDP canonical URL pattern:** what is the public URL for a Print PDP given a `url_slug`? Needed for `link` and `defaults.pdpBaseUrl`.
3. **Price source & quantity tier:** print products have quantity-tiered pricing. Which price goes to GMC — a `price` column in the export, or the Zazzle base/min-quantity price? Which currency handling beyond USD (v1 is USD only)?
4. **`product_type` → `googleProductCategory` map:** provide the mapping table, or accept Google's auto-assignment for v1?
5. **Brand value:** constant `"Adobe Express"`, or a per-product/department value?
6. **Identifier strategy:** confirm print products have no GTIN/MPN (so `identifierExists: false` is correct), or supply identifiers if they exist.
7. **Chunk size & delay:** confirm ~250–500 products/chunk and the diagnostics delay window are acceptable in the browser UX. (If unattended runs or >~10k catalogs are needed, switch to the async upload-to-storage + poll model — noted in §3.)
8. **Catalog scale:** default GMC item quota is **150,000/account**; for larger catalogs submit the Merchant Center item-quota increase request early (requires ≥80% utilization + <20% disapproval history). Also respect the **2-updates-per-product-per-day** policy in re-sync cadence.
9. **Workspace strategy:** confirm Stage vs Prod Adobe I/O workspaces map to test vs prod GMC accounts (recommended).
