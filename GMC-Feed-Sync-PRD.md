# GMC Feed Sync — PRD (v1)

Status: draft, produced from a /grill-me session on 2026-07-29.
Covers: MWPW-199551 ((Print PDPs) GMC Feed — Integrate Google Merchant Center API) and its subtask MWPW-202332 ([GMC Feed] GMC Integration Strategy).
Scope of this document: **the Adobe I/O Runtime sync service only.** The DA (Document Authoring) tool / Document Generator UI is a separate workstream and is referenced here only to define the contract at the boundary.

---

## 1. Summary

Adobe Express Print product listings need to reach Google Merchant Center (GMC) programmatically instead of via manual updates. This service is a set of Adobe I/O Runtime (App Builder) actions that accept product rows already assembled by the DA tool and submit them to GMC via the **Merchant API v1 (stable)** — not the legacy Content API for Shopping, which the ticket originally referenced and which sunsets 2026-08-18.

## 2. Architecture

```
DA Document Generator (browser, no backend)
  → calls Zazzle partner API directly (getproductfromtemplate, getproductpricing)
  → author overrides / curation
  → exports flattened product rows
  → POST rows to `sync-products` (Adobe I/O, IMS-authenticated)
       → Merchant API v1 (productInputs.insert, per-row, concurrent, not batched)
  → separately, independently invoked: `diagnostics` reads per-product status from GMC and reports it back
```

**Decision: `diagnostics` is a fully separate action/API, never called from inside `sync-products`.** `sync-products` returns only the result of the insert calls it made (§ API contract below); it does not chain into a diagnostics check before responding. Diagnostics is invoked independently (by the DA tool for its status column per MWPW-202332 Req #2, or by an operator running the "check first" flow manually) and reads GMC's own state, not `sync-products`'s output.

**Decision:** the Adobe I/O side never calls the Zazzle API directly. The DA tool is the only thing that talks to Zazzle; it owns fetching, author overrides, and flattening. `sync-products` receives ready-to-map rows and its only job is: validate → map to GMC's product shape → submit → return per-row results. This matches the original handoff doc, the last merged commit, and the Jira ticket's description of the payload (`title, description, link, image_link, price, availability, condition, google_product_category, brand`).

An uncommitted experiment in the current working tree (`actions/sync-products/index.js`) has the Adobe I/O action fetching Zazzle directly against a hardcoded list of ~70 template IDs. This is dev/smoke-test scaffolding, not the target architecture, and should be removed.

## 3. Data source: Zazzle Partner API (DA tool's source, documented here for the mapping table below)

Three relevant endpoints, all under `https://www.zazzle.com/svc/partner/adobeexpress/v1/`:

**`getproductfromtemplate`** (by `templateId`) — returns, among others:
`product.id` / `product.rootProductId` (numeric Zazzle product id), `product.title` / `product.rootRawTitle`, `product.description`, `product.attributeDescription` (free-text fabric/fit spec, not structured), `product.pricing.unitPrice`, `product.productType` (raw string, e.g. `zazzle_shirt`), `product.departmentName`, `product.initialPrettyPreferredViewUrl` (+ `product.realviews[]`), `product.attributes.{style,color,size}.value` (structured, but only exists for variant-bearing products like apparel), `product.isInStock`, `product.url` (a **zazzle.com** URL — not usable as GMC's `link`), `product.designId`.

**`getproductpricing`** (by `productId` + `productOptions`) — returns `data.unitPrice`, `data.discountProductItems[]` (`price`, `priceAdjusted`, `discount`, `discountPercent`, `discountCode`, `discountEnd`, `discountString`) and `data.volumeDiscountTiers[]` (bulk-quantity discounts — not relevant to a single-unit GMC listing, ignore). **No discount *start* date is returned anywhere in this response.**

**`getshippingestimates`** (by `productId` + qty) — returns `data.estimates[]` (`method`, `methodVerbose`, delivery date windows, `isUS`). No shipping **cost**, no minimum-order-quantity. Useful only as a possible input to *composing* a `shipping_label` value — not a source of one directly.

## 4. Field mapping — GMC feed field ↔ source

| GMC field | Source | Status |
|---|---|---|
| `id` / `offerId` | Zazzle template URN, sanitized (`sanitizeOfferId`: trim, strip constant `urn:aaid:sc:<catalog>:` namespace prefix, `:`→`-` for anything else) | ✅ implemented. **Found and fixed via a live insert rejection, not a design decision:** the full sanitized URN (`urn-aaid-sc-VA6C2-<uuid>`, 54 chars) exceeds Google's real 50-char `id` limit — confirmed both by the API's own error ("Value too long in attribute: id") and the product data spec. The `urn:aaid:sc:VA6C2:` prefix is a constant namespace tag, identical across every product example seen in this project; stripping it leaves just the 36-char UUID, comfortably under the limit. `validate.js` now checks this against the *sanitized* offerId (not the raw `product_id`), since the raw URN is still 54 chars pre-stripping. |
| `title` | Zazzle `product.title` (DA author may override) | ✅ implemented, truncated to 150 chars |
| `description` | Zazzle `product.description` (DA author may override) | ✅ implemented |
| `link` | **DA-authored PDP URL on adobe.com** — NOT Zazzle's own `product.url` (points to zazzle.com) | ✅ implemented, validated against `pdpAllowedHosts` allowlist |
| `image_link` | Zazzle `product.initialPrettyPreferredViewUrl` | ✅ implemented |
| `availability` | Zazzle `product.isInStock` → `IN_STOCK`/`OUT_OF_STOCK` (UPPER_SNAKE_CASE, per handoff §4 correction) | ✅ implemented |
| `condition` | Static default `NEW` | ✅ implemented |
| `price` | Zazzle `product.pricing.unitPrice` → integer micros + `currencyCode` | ✅ implemented (`toMicros`) |
| `sale_price` | Zazzle `discountProductItems[].priceAdjusted` | ✅ resolved — available directly whenever an active discount item is present |
| `sale_price_effective_date` | `{sync time}/{discountProductItems[].discountEnd}` | ✅ resolved — Zazzle gives no discount *start* date, so sync time is used as the start. **Only set `sale_price`/`sale_price_effective_date` when `discountEnd` is later than the current time; if `discountEnd` has already passed (or there's no `discountProductItems` entry at all), omit both fields entirely** rather than submitting a stale/expired sale. **Implementation note (found and fixed during build):** the installed `@google-shopping/products` v1 proto types `salePriceEffectiveDate` as `google.type.Interval` (`{startTime: {seconds}, endTime: {seconds}}`), **not** a `"start/end"` string — the string form throws `TypeError: object expected` at insert time. `mapProduct.js` builds the structured Interval object; verified via a live `ProductAttributes.fromObject()` round-trip and covered by a `mapProduct.test.js` case. |
| `google_product_category` | `config/category-map.json` keyed by Zazzle's raw `product_type`, OR an explicit `google_product_category` field supplied directly on the row (takes precedence over the map) | ✅ implemented, **mandatory as of this decision** (supersedes the earlier "fine to omit, Google auto-classifies" stance). `validate.js` rejects any row that can't resolve a value either way — `resolveGoogleProductCategory()` in `mapProduct.js` is the single shared resolution logic used by both. Practical consequence: `category-map.json` only has 3 seeded entries (§ config/README.md), so any row whose `product_type` isn't one of those three is now a hard validation failure unless the DA tool sends `google_product_category` directly. Full map coverage from the ticket owner (§12.3) is no longer just a nice-to-have — it's a blocker for any product_type outside the 3 seeded values, unless the DA tool takes on supplying the category directly for those rows. |
| `product_type` (human label, e.g. "Print > T-Shirts") | `"Print > " + product.departmentName` from Zazzle `getproductfromtemplate` | ✅ resolved — no static map needed, derived directly per-row. Note: `departmentName` can be more granular/gendered than the target label (e.g. Zazzle returns `"Men's T-Shirts"` for the T-shirt example, one level more specific than `expected_data.md`'s `"Print > T-Shirts"`) — confirm whether to pass `departmentName` through as-is or trim gender/segment qualifiers before prefixing. |
| `brand` | Static default `"Adobe Express"` | ✅ implemented |
| `identifier_exists` / `mpn` / `gtin` | Zazzle has no GTIN/MPN concept | ⚠️ **OPEN.** Current code sets `identifierExists:false` when no gtin is present, and README marks this "resolved." But all three `expected_data.md` examples show `identifier_exists: TRUE` — and are themselves inconsistent with each other (business card's `mpn` = its own URN; mug's `mpn` is a *different* URN than its own `id`; T-shirt has `identifier_exists:TRUE` with no `mpn`/`gtin` at all, which violates Google's own policy that identifierExists:true requires brand+GTIN or brand+MPN). **Interim default: keep `identifierExists:false`** (the current, policy-safe behavior) until the ticket owner confirms the intended pattern. |
| `material` / `color` / `size` | Zazzle `product.attributes.{color,size}` for variant-bearing products (apparel, mugs) | ✅ implemented — real structured string fields in the v1 proto (`products_common.proto:887,915,1035`), simple pass-through when the row supplies them |
| `age_group` / `gender` | Same source as above | ✅ implemented — **these are proto enums, not free strings** (`AgeGroup`/`Gender` types), and require UPPER_SNAKE_CASE values (e.g. `ADULT`, `UNISEX`); lowercase values (as shown in this PRD's own §7.1 example row) are silently dropped by the client library. Mapper uppercases the row value before setting, consistent with the existing `availability` precedent. |
| `printing_type` / `capacity` | No structured Zazzle field for either; likely needs DA-author manual entry | ✅ implemented, via a fix during build — neither field exists anywhere in the installed v1 proto (setting them as top-level attributes was a silent no-op; the client library drops unrecognized fields without erroring). Rerouted through the proto's real `customAttributes` mechanism instead (`repeated CustomAttribute {name, value}`, `productinputs.proto:259` / `types.proto:65` — this is the same escape hatch discussed earlier in this PRD's design for "fields with no structured GMC equivalent"), only included when the row supplies them. Verified via a live `ProductInput.fromObject()` round-trip. |
| `custom_label_0` | No Zazzle source in any of the 3 endpoints checked | ⚠️ **OPEN provenance** (looks like manually curated business/reporting taxonomy, e.g. region + category — not scraped from any API), but pass-through **is implemented**. Real generated field name is `customLabel_0` (underscore retained before the digit) — `customLabel0` is silently dropped. |
| `minimum_order_quantity` | No Zazzle source found | ✅ implemented, defaults to `1` when the row omits it. Also has no dedicated proto field — implemented via the `customAttributes` mechanism (see `printing_type`/`capacity` above), always present (default ensures it's never omitted). |
| `shipping_label` | Not a literal Zazzle field — `getshippingestimates` gives `method`/`methodVerbose`/`isUS`, which could feed a *composed* label (e.g. `${region}_${methodVerbose}_Shipping`) | ⚠️ **OPEN** — provenance/composition rule unconfirmed; not implemented |

Note on `sale_price`/`sale_price_effective_date`: `discountProductItems` is an array and Zazzle can return more than one concurrently-active entry (e.g. different discount codes). Which one to use when there's more than one isn't yet decided — candidates are "first entry," "entry with `discountCodeIsApplied:true`," or "entry with the largest `discountPercent`." Not a blocker for the common single-discount case, but needs a rule before launch (§12.6).

**Fields flagged unclear per your request, summarized:** `google_product_category`, `product_type` (label), `identifier_exists`/`mpn`/`gtin`, `sale_price_effective_date` (start date), `custom_label_0`, `minimum_order_quantity`, `shipping_label`. No field literally named `google_product` exists in `expected_data.md` or either Zazzle endpoint — if that referred to something other than `google_product_category`, it needs a pointer to where it's used.

### 4.1 Which fields are mandatory

Three different things can be meant by "mandatory," and they don't always line up — a field can have a safe server-side default (so the DA row can omit it), or be recommended-not-required by Google, or be hard-required only for certain categories. Table below distinguishes: **required in the DA→sync-products row**, **always present in the outgoing GMC payload**, and **Google's actual requirement level** (per Google's product data spec — id/title/description/link/image_link/price/availability are Google's genuinely hard-required attributes; brand is required only when a brand is associated or serving as an identifier; everything else is recommended or category-conditional, not hard-required for the API call to succeed). [Source: Google Merchant Center product data spec.](https://support.google.com/merchants/answer/7052112?hl=en)

| Field | Required in DA row? | Always in GMC payload? | Google's actual requirement |
|---|---|---|---|
| `product_id` | Yes — hard reject if missing (implemented) | Yes | Hard required (item identity) |
| `title` | Yes — hard reject if missing (implemented) | Yes | Hard required |
| `link` | Yes — hard reject if missing (implemented) | Yes | Hard required |
| `image_link` | Yes — hard reject if missing (implemented) | Yes | Hard required |
| `price` | Yes — hard reject if invalid (implemented) | Yes | Hard required |
| `description` | ⚠️ **Gap — not currently enforced.** `validate.js` allows it empty/missing; `mapProduct.js` defaults to `''`. Google's spec lists description as hard-required, and an empty string is likely to fail approval. **Should become a hard-reject-if-missing field**, same tier as title/link/image_link/price. | Currently yes, but as an invalid empty string when omitted | Hard required |
| `availability` | No — safe default (`IN_STOCK`) covers it | Yes | Hard required, satisfied by the default |
| `condition` | No — safe default (`NEW`) covers it | Yes | Recommended (hard-required only for used/refurbished items) |
| `brand` | No — safe default (`"Adobe Express"`) covers it | Yes | Required when a brand is associated, or as part of the GTIN/MPN identifier pair — always satisfied here since it's static |
| `google_product_category` | Conditionally — either directly on the row, or via `product_type` resolving through `category-map.json`; hard reject if neither resolves (implemented) | Yes | Recommended by Google (not hard-required for `productInputs.insert` to return `200`), but **project decision: made mandatory in our validation** rather than relying on Google's auto-classification fallback |
| `product_type` (label) | No, but effectively always derivable once `department_name` is on the row (§4) | Yes, once implemented | Optional for Google, useful for reporting |
| `identifier_exists` / `gtin` / `mpn` | No — deferred (§12.2) | `identifierExists:false` currently, always | Not individually required — the **combination** must be internally consistent (brand+GTIN, brand+MPN, or `identifierExists:false`); this is the open question in §12.2, not a plain mandatory/optional split |
| `color` / `size` / `gender` / `age_group` | No — correctly product-type-conditional (a business card has none) | Only when supplied | **Category-conditional required-for-approval**: Google's Apparel & Accessories vertical requires these for full Shopping approval once `google_product_category` resolves to an apparel category. Not required for `productInputs.insert` to return `200`, but required for the listing to actually go live — worth the DA tool prioritizing these once `category-map.json` is populated for apparel rows. |
| `material` / `printing_type` / `capacity` | No | Only when supplied | Fully optional, no Google requirement |
| `sale_price` / `sale_price_end_date` | No | Only when an active discount exists (§4) | Optional, recommended when applicable |
| `custom_label_0` / `shipping_label` / `minimum_order_quantity` | No | Only when supplied | Fully optional — business/reporting use only, no Google requirement |

## 5. Locale scope

**v1 targets US / en-US / USD only.** The `expected_data.md` CA and UK rows are illustrative of a future multi-locale iteration, not a v1 build target — this directly follows the ticket's own scope note ("starting US/en-US, multi-locale scoped for future iteration"), which takes precedence over the example data here. `contentLanguage`/`feedLabel` stay as configured constants (`en`/`US`) rather than becoming per-row fields in v1.

## 6. Auth

**Final decision: service account only.** `actions/lib/auth.js` builds a `GoogleAuth({ credentials, scopes })` client directly from `GMC_SERVICE_ACCOUNT_JSON` — the OAuth2 client-id/secret/refresh-token flow has been removed entirely (no dual-support). This matches the handoff/Jira ticket's "non-negotiable" recommendation: service account is the only flow that authenticates with zero human interaction, which is what an automated server-to-server sync needs, and it avoids the OAuth "Testing" publishing-status 7-day refresh-token expiry risk that would otherwise break unattended automation on a recurring basis.

This was blocked earlier in the project because `gmc-service-account.json`'s `private_key` was a 35-character placeholder, not a real PEM key (an OpenSSL decoder error on token-mint confirmed this). A real key has since been downloaded from GCP Console and verified working — `test-google-connection` and `sync-products` both authenticate successfully against it (moved past `401`/decoder errors to real `INVALID_ARGUMENT` validation responses from the Merchant API, i.e. auth itself succeeds).

`getAuthClient()` optionally cross-checks the key against `GMC_GCP_PROJECT_ID` (project) and `GMC_SERVICE_ACCOUNT_EMAIL` (identity) when those params are set, rejecting a key for the wrong project/identity before any API call is attempted — mirrors the equivalent check the removed OAuth path used to do against `GMC_GCP_PROJECT_ID`.

`gmcClients.js` passes this `GoogleAuth` instance straight through to all four GAPIC clients (`productInputs`, `products`, `dataSources`, `reports`) without any extra wrapping — `GoogleAuth` already exposes `getUniverseDomain()`, which google-gax's `GrpcClient.createStub` needs (see §9 item 6 for the historical bug this fixed, back when only `dataSources` was wrapped and the others got a bare client).

`test-google-connection` no longer builds an independent auth path — now that service account is the only path, it just reuses `makeClients`/`gmcClients.js` like every other action, and exists purely as a lightweight smoke test (auth + `dataSources.listDataSources`, no product data pushed).

## 7. Actions inventory

| Action | Purpose | v1 status |
|---|---|---|
| `sync-products` | Validate rows, map to GMC product shape, `productInputs.insert` per row, concurrent (pool=15), retry-once on retriable errors, return per-row `{offerId, ok, name\|error}` | In scope — restore to `HEAD`'s working implementation (validation, client construction, and `insertWithRetry` calls are currently commented out / stubbed in the working tree; see §9) |
| `diagnostics` | Read per-offerId or whole-feed status via `reports.search` / `products.get`, post a Slack digest | In scope — unaffected by the current regressions |
| `bootstrap-datasource` | One-time, privileged: create the GMC data source per environment via `dataSources.createDataSource` | In scope — restore to `HEAD`'s GAPIC-based implementation (the working tree's raw-`fetch` rewrite has real bugs; see §9) |
| `test-google-connection` | Diagnostic-only, admin (`web: no`): call `dataSources.listDataSources` for a given account via the shared `makeClients`/`auth.js` path, to smoke-test that the deployed service-account credential works end to end | Reuses the same auth path as every other action (§6) — no product data pushed. Not part of the production sync pipeline. |
| **remove/delete-product** | Explicit `productInputs.delete` to fully remove a listing (required by MWPW-202332 Req #4 — "must call the delete-product-input equivalent... a product that's simply no longer resubmitted stays live in Shopping until deleted") | **Out of scope for this PRD.** No such action exists today. Flag explicitly: this is a hard blocker for MWPW-202332's bulk-unpublish acceptance criterion regardless of any DA-tool UI work — needs its own follow-up ticket/PRD. |

### 7.1 `sync-products` API contract

**Request:** `POST` with `{ env: "test"|"prod", products: [...] }`, `Authorization` header required. Each entry in `products` follows the row shape in §4 (mandatory core + optional per-product-type attributes). `products.length` must be ≤50 per request (§8) — the DA tool chunks larger exports into multiple calls.

**Example request** (two rows — a T-shirt showing the full optional-attribute set + an active sale, and a business card showing the core-only case with fields left to their defaults):

```json
POST /sync-products
Authorization: Bearer <IMS token>
Content-Type: application/json

{
  "env": "test",
  "products": [
    {
      "product_id": "urn:aaid:sc:VA6C2:3941fa64-5bb9-581a-b69c-8813664e23ba",
      "title": "Playful and Fun Ice Cream Truck T-Shirt",
      "description": "Design your own custom playful and fun ice cream truck T-shirt online for free using Adobe Express.",
      "link": "https://www.adobe.com/express/print/t-shirt/playful-and-fun-ice-cream-truck-t-shirt",
      "image_link": "https://rlv.zcache.com/playful_and_fun_ice_cream_truck_t_shirt_tri_blend_shirt-re8018cb7ef7642c0946afe39b5772956_v6evzq_1000.jpg",
      "price": 28.55,
      "availability": "IN_STOCK",
      "condition": "NEW",
      "brand": "Adobe Express",
      "product_type": "zazzle_shirt",
      "department_name": "Men's T-Shirts",
      "sale_price": 14.28,
      "sale_price_end_date": "2026-01-15T00:00:00-05:00",
      "material": "Bella+Canvas Tri-Blend",
      "color": "White",
      "printing_type": "Classic Printing: No Underbase",
      "size": "Adult S",
      "age_group": "adult",
      "gender": "unisex"
    },
    {
      "product_id": "urn:aaid:sc:VA6C2:f1ba7b87-23aa-5c0c-902f-0481e4dadded",
      "title": "Green and White Personal Business Card - Squared Corners",
      "description": "Design and print green and white personal business cards that stand out with Adobe Express, the quick and easy create-anything app.",
      "link": "https://www.adobe.com/express/print/business-card/green-and-white-personal-business-card",
      "image_link": "https://rlv.zcache.com/green_white_personal_business_card-r2113574119b746c9ae00687a40613b56_tcvtq_1000.jpg",
      "price": 32.63,
      "availability": "IN_STOCK",
      "product_type": "zazzle_business_card",
      "department_name": "Business Cards"
    }
  ]
}
```

Notes on this example:
- `product_id` is the raw Zazzle URN (colons included) — `sanitizeOfferId` handles the `:`→`-` conversion server-side, idempotently, so the DA tool doesn't need to pre-sanitize it.
- `condition`/`brand` are omitted from the business card row on purpose, to show the default fallback (`NEW`/`"Adobe Express"`) taking over — they don't need to be sent when they match the default.
- `department_name` and `sale_price`/`sale_price_end_date` are **new fields not in README's original "expected input row shape" table** — they're needed to support the `product_type` (§4) and sale-price (§4) mappings decided in this PRD, so the DA tool's export needs to add them. `sale_price`/`sale_price_end_date` should simply be omitted from the row entirely when there's no active `discountProductItems` entry (rather than sent as `null`/empty) — the mapper treats their absence and an already-expired `sale_price_end_date` the same way (no sale attributes on the GMC side).
- Since v1 is US-only (§5), there's no currency field on the row — `price`/`sale_price` are assumed USD.

**Response — three cases:**

1. **Pre-flight failure (`500`)** — the request was well-formed but nothing could be attempted at all: auth/credential failure, data source resolution failure. No items were touched.
   ```json
   { "error": "GMC authentication failed", "detail": "..." }
   ```
2. **Bad request (`400`)** — guard-clause failure before any GMC call: missing/invalid `env`, missing/empty `products`, `products.length` over the chunk ceiling (§8), missing `Authorization`. Also no items touched.
3. **Attempted (`200`)** — the request was processed and every item was individually attempted against GMC, **regardless of how many succeeded** (even 0/N succeeding is still `200`, not `500` — see decision below). Per-item outcomes:
   ```json
   {
     "env": "test",
     "dataSource": "accounts/5830778204/dataSources/10693230513",
     "submitted": 50,
     "succeeded": 47,
     "failed": 3,
     "pushedIds": ["urn-aaid-sc-VA6C2-3941fa64...", "..."],
     "failedItems": [
       { "productId": "urn-aaid-sc-VA6C2-f1ba7b87...", "reason": "INVALID_ARGUMENT: missing link" }
     ]
   }
   ```
   When everything succeeds, `failedItems` is simply `[]`. (Renamed from the placeholder "templateIdErrors" you floated — `failedItems` reads clearer and pairs naturally with `pushedIds`.)

**Decision: `500` is reserved for pre-flight failure only.** If the request is well-formed and GMC calls were actually attempted, the response is always `200` with the per-item breakdown above, even if every single item failed for its own reason (bad data, GMC rejection, etc.). This lets the DA tool parse one consistent shape regardless of outcome, and keeps "the service is broken" (500) distinguishable from "GMC rejected these specific products" (200 + `failedItems`).

This contract is a proposal, not yet implemented — `test/unit/sync-products.test.js` currently asserts a different shape (`results: [{offerId, ok, name|error}]`) and will need updating to match once this is confirmed. Flag if `pushedIds`/`failedItems` naming or shape doesn't work for the DA tool's needs.

## 8. Environment / config

- Test Merchant Center **account** ID: **5830778204**. (Correcting two stale values found in the repo: `582778` in the handoff/README, and `5830961219` in `.env.example` / the untracked `Untitled-1.json` — neither is current.)
- Test **data source** ID (`GMC_DATASOURCE_ID_TEST`, created via `bootstrap-datasource`, referenced on every product write): **10693230513**. These are two different IDs (account vs. data source within that account) — don't conflate them in config. Production data source ID: **TBD**, to be created via `bootstrap-datasource --param env prod` once a decision is made on when to cut over.
- **`MAX_CHUNK` lowered from 500 to 50** (supersedes the earlier "keep as-is" call) — Adobe I/O Runtime has a **1MB hard payload limit** that 500 items doesn't respect in the worst case. `validate.js`'s own per-field ceilings (title ≤600 chars, description ≤5000, link/image_link ≤2000 each) put a single worst-case row at roughly ~10KB; 500 such rows could reach several MB, well past the 1MB wall. 50 rows × ~10KB ≈ 500KB, comfortably under the limit with margin for JSON overhead and multi-byte characters — and conveniently matches MWPW-199551's own "50 products" acceptance-criterion scale. No separate byte-size check is added; the lowered count ceiling is the enforcement mechanism (per your call to keep this simple rather than adding a second check).
- Concurrency pool = 15: **keep as-is**, unaffected by the above.
- GCP developer registration (`developerRegistration.registerGcp`) against project `adbe-gcp1060`: **assumed already done out-of-band.** Not a code deliverable here — verify it's actually done before first deploy, since calls fail with `AUTH_GCP_NOT_REGISTERED` until it is.
- Security posture — **restore to `HEAD`'s values**, both of which regressed in the uncommitted working tree:
  - `require-adobe-auth: true` on all three actions (currently `false` on disk — this would let `sync-products`, a write path into a live GMC feed, be called without a valid IMS token).
  - `bootstrap-datasource` → `web: 'no'` (currently `'yes'` on disk — this is a privileged, rarely-run, admin/CLI-only operation and shouldn't be a public web endpoint).
- `.gitignore` updated (done, this session) to cover `Untitled-1.json` and `"My special vars.md"`, both untracked files in the repo root containing live-looking credentials that weren't previously covered by any ignore pattern.

## 9. Baseline reconciliation — regressions to fix before this ships

The last merged commit (`d262e65`) is a clean, internally-consistent, spec-compliant implementation. The current uncommitted working tree has since regressed several files simultaneously (confirmed by running the test suite: 3 of 11 suites fail, 14/114 tests). **Decision: `HEAD` is the baseline for everything except `auth.js`** (§6). Concretely, revert/fix:

1. `actions/lib/insertWithRetry.js` — currently a stub that logs and returns `undefined`; the full retry-once-on-5xx/429 implementation exists commented-out in the same file and should be restored.
2. `actions/sync-products/index.js` — the real guard clauses (`checkMissingRequestInputs`, `env` validation, `products` array validation, chunk-size check) and the `resolveAccount/resolveDataSource/makeClients` block are commented out; restore them. Remove the hardcoded `PDPproducts` fixture array, `getPDPConfiguration()`, and the ad-hoc `mapPrintDataToGMCFormat` — these belong to the rejected "fetch Zazzle directly" architecture (§2) and additionally hardcode `availability` as lowercase `'in_stock'`, which the handoff explicitly warns against (GMC enums are UPPER_SNAKE_CASE).
3. `actions/bootstrap-datasource/index.js` — restore the GAPIC `dataSources.createDataSource(...)` call (currently commented out in favor of a raw `fetch` with a missing `await` and a `ReferenceError` on an undefined `response` variable). Also fix: it currently hardcodes `resolveAccount(params, "prod")` regardless of the caller's `params.env`, and logs the raw bearer token via string interpolation (bypasses `redact.js` entirely — a direct violation of the handoff's "no sensitive data in logs" requirement).
4. `app.config.yaml` — see §8 security posture.
5. **New fix, not a regression** — `actions/lib/validate.js`/`mapProduct.js` currently treat `description` as optional (empty string allowed/defaulted). Per §4.1, Google's product data spec makes `description` hard-required like `title`/`link`/`image_link`/`price` — change `validate.js` to reject rows with a missing/empty `description`, same tier as the other core fields.
6. **`actions/lib/gmcClients.js` — found and fixed via a live `sync-products` invoke, not a design decision.** Only the `dataSources` client was wrapped in `new GoogleAuth({ authClient: auth })`; `productInputs`, `products`, and `reports` were all constructed with the bare `OAuth2Client` `getAuthClient()` returns. Installed `google-gax` calls `auth.getUniverseDomain()` when creating a gRPC stub — a method that exists on `GoogleAuth` but not on `OAuth2Client`/`AuthClient` — so every real insert call crashed with `TypeError: this.auth.getUniverseDomain is not a function`, *after* the per-item error handling had already caught a gRPC failure and sent the `200` response (explains why the response body showed `ok=0 failed=5` before the crash appeared in the logs). This inconsistency was actually noted as "worth probing" all the way back in this PRD's very first codebase exploration (§ Auth, `gmcClients.js` discussion) but wasn't confirmed as an active bug until it actually crashed. Fixed by wrapping `auth` once and using the wrapped version for all four clients; regression test added (`test/unit/gmcClients.test.js`).
7. **`sanitizeOfferId` — found and fixed via a live insert rejection, not a design decision.** See the `id`/`offerId` row in §4 — the full sanitized URN exceeded Google's 50-char `id` limit. Fixed by stripping the constant `urn:aaid:sc:<catalog>:` prefix; `validate.js` now enforces the 50-char limit against the sanitized offerId rather than the raw `product_id`. `insertWithRetry.js`'s log line was also found to be dropping the actual Google error `message` (only `code`/`status`/`reason` were logged, and `reason` is empty for auth-layer failures that carry no structured error-details payload) — fixed to log `message` too; the HTTP response body (`failedItems[].reason`) already included it.
8. **Auth model switched from OAuth2 to service account exclusively, once a real key was verified working (§6).** `actions/lib/auth.js` rewritten around `parseServiceAccountJson`/`GMC_SERVICE_ACCOUNT_JSON` (dropping `parseOAuthConfig`/`OAuth2Client`/`GMC_CLIENT_ID`/`GMC_CLIENT_SECRET`/`GMC_REFRESH_TOKEN` entirely); `gmcClients.js` simplified to pass the resulting `GoogleAuth` straight through (no extra wrapping needed, since `GoogleAuth` already has `getUniverseDomain()`); `test-google-connection` now reuses `makeClients` instead of building an independent auth path; `app.config.yaml`/`.env.example` updated to the new params (`GMC_SERVICE_ACCOUNT_JSON`, `GMC_SERVICE_ACCOUNT_EMAIL`, `GMC_GCP_PROJECT_ID`); `scripts/get-gmc-consent-url.js` and `scripts/exchange-gmc-code.js` (OAuth consent-flow helpers) deleted as dead code; `scripts/check-gmc-auth.js` rewritten against the service-account path.

## 10. Requirement coverage — MWPW-199551

| # | Requirement | Coverage |
|---|---|---|
| Prereq 1 | GCP project registered against Merchant account | Assumed done externally (§8) |
| Prereq 2 | Data source ID exists before any product write | `bootstrap-datasource` (§7, §9) |
| Req 1 | Auth configured, calls succeed without error | §6 — service account, verified working |
| Req 2 | Primary data source created once, reused, stored in config | `bootstrap-datasource` + `GMC_DATASOURCE_ID_{TEST,PROD}` |
| Req 3 | Product insertion with the 8 named fields, price as integer micros + currency | §4 mapping table; price handled correctly today |
| Req 4 | No batch endpoint — individual concurrent inserts, per-item error logging | `sync-products` + `runPool`/`insertWithRetry` (once restored, §9) |
| Req 5 | Diagnostics endpoint called post-sync, errors surfaced to log/Slack | `diagnostics` action — a **separate, independently-invoked** action/API, not called from within `sync-products` (§2). "Called after each sync" means as a distinct step by the caller (DA tool or operator), not a chained server-side call. |
| Req 6 | Correct target country/language, starting US/en-US | §5 — US-only v1, confirmed |
| Req 7 | 4xx/5xx caught, logged with product ID + reason, retried once, no silent failures | `insertWithRetry` (once restored, §9) |
| Req 8 | Config-driven credentials, no hardcoded secrets, Test Account for local/QA | §8, §6 |

## 11. Requirement coverage — MWPW-202332 (DA tool side — informational, defines the contract this backend must support)

Explicitly out of scope for this PRD per that ticket's own "Out of Scope" section ("the underlying GMC API integration itself... covered by parent MWPW-199551"). Backend-relevant implications only:

| # | Requirement | Backend implication |
|---|---|---|
| 2 | Status column sourced from Diagnostics endpoint, not a local flag | Satisfied by existing `diagnostics` action design — no change needed |
| 3 | Bulk upload, per-row success/failure surfaced | Satisfied by `sync-products`'s per-row result array, once restored (§9) |
| 4 | Bulk unpublish must call an explicit delete | **Blocked — no delete action exists** (§7). Hard dependency for this ticket, out of scope here. |
| 5 | Row-level linkage via a stable key | Satisfied — `offerId` (sanitized URN) is stable and already returned per-row |
| 6 | Rate-limit awareness, client-side throttling | DA-tool-side concern per that ticket's own framing; backend already retries once on `RESOURCE_EXHAUSTED` (once restored, §9) |
| 7 | Per-row audit logging | Satisfied by per-row result objects + activation logs |
| 8 | Bulk unpublish restricted to authorized roles | DA-tool/IMS-permissions concern, not this service |

## 12. Explicit open questions / blockers (do not silently resolve)

1. ~~**Auth model final sign-off**~~ — resolved: service account only, OAuth2 implementation removed entirely (§6). A real key replaced the placeholder in `gmc-service-account.json` and has been verified working end to end.
2. **`identifierExists`/`mpn`/`gtin` strategy** — current code and `expected_data.md` disagree, and the example data is internally inconsistent (§4).
3. **`category-map.json` completion** — only 3 seeded values; needs the ticket owner's full Zazzle-`product_type` → `google_product_category` (numeric) mapping (§4). No longer blocks the human-readable `product_type` label, which is now derived directly from `departmentName`. **Escalated in priority**: since `google_product_category` is now mandatory (§4/§4.1), any unmapped `product_type` is a hard validation rejection, not a soft "Google auto-classifies" fallback — either this map needs full coverage, or the DA tool must supply `google_product_category` directly for rows whose `product_type` isn't (yet) mapped.
4. **`custom_label_0` / `shipping_label` provenance** — no clean API source found for either; likely need a product decision on static config vs. DA-author entry (§4). (`minimum_order_quantity`'s provenance question is resolved — static default of `1`, implemented.)
5. **Delete/remove action** — not built, blocks MWPW-202332 Req #4 (§7, §11).
6. **Which `discountProductItems[]` entry to use when Zazzle returns more than one concurrently** — not yet decided; see §4 note. This is the DA tool's problem when it flattens the row (it sends one already-chosen `sale_price`/`sale_price_end_date` pair), not `sync-products`'s.
7. **Whether to pass `departmentName` through as-is or trim gender/segment qualifiers** — Zazzle's `departmentName` can be more granular than the target label (e.g. `"Men's T-Shirts"` vs. `expected_data.md`'s `"Print > T-Shirts"`) (§4).
8. **`scripts/check-gmc-auth.js` still hardcodes the stale test account ID `582778`** — out of scope for the implementation pass (scripts weren't touched), but now inconsistent with the corrected `5830778204` in `.env.example`/README (§8). Minor follow-up.

## 13. Out of scope (v1)

Per the ticket: Promotions API, inventory management, Product Studio AI attributes, real-time/scheduled sync triggers. Per this PRD: the DA tool/Document Generator UI itself, multi-locale submission, and the delete/remove action (§12.6).
