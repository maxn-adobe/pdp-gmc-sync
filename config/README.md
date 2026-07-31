# config/

## defaults.json
Product-level defaults consumed by `actions/lib/mapProduct.js` and
`actions/lib/validate.js`.

- `pdpAllowedHosts` — allowlist of hostnames the `link` column may resolve
  to. Currently: `www.adobe.com` (production) and
  `main--da-express-milo--adobecom.aem.live` (AEM preview). Any row whose
  `link` resolves to a host outside this list is rejected in validation.
- `brand` — static brand string applied when a row does not override.
- `availability`, `condition`, `currency`, `feedLabel`, `contentLanguage` —
  applied when a row does not override.

## category-map.json
Zazzle `product_type` → `googleProductCategory`. **`google_product_category` is
now mandatory** — `validate.js` rejects any row that can't resolve one, either
via this map (keyed by `product_type`) or an explicit `google_product_category`
field supplied directly on the row (which always takes precedence). An
unmapped `product_type` with no explicit override is a hard validation
failure, not a silent Google-auto-assigns fallback.

Keys must match the **raw** Zazzle `product_type` string as it appears in
the DA tool export (e.g. `zazzle_shirt`, `zazzle_business_card`,
`zazzle_mug`). The mapper does not normalize keys before lookup.

Current contents:

```json
{
  "zazzle_shirt": "212",
  "zazzle_business_card": "3109",
  "zazzle_mug": "2162"
}
```

Confirmation status of these 3 values (as of this session):
- `zazzle_shirt` → `212` — **confirmed** via a live Zazzle API response this
  session.
- `zazzle_business_card` → `3109` and `zazzle_mug` → `2162` — **best-guess
  placeholders only**, never confirmed against a live Zazzle response.

Regardless of the above, the full Zazzle `product_type` → GMC
`googleProductCategory` mapping still needs the ticket owner's input — see
PRD §12.3 / handoff §20 Q4. Until it's complete, any `product_type` outside
this map will have its rows rejected at validation unless the DA tool sends
`google_product_category` directly for those rows.
