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
Zazzle `product_type` → `googleProductCategory`. **Empty by default** — an
empty map is fine: Google auto-assigns a category when the field is omitted.

Keys must match the **raw** Zazzle `product_type` string as it appears in
the DA tool export (e.g. `zazzle_hoodie`, `zazzle_business_card`,
`zazzle_mug`). The mapper does not normalize keys before lookup.

Example:

```json
{
  "zazzle_business_card": "5498",
  "zazzle_mug": "2918",
  "zazzle_t_shirt": "212"
}
```

See handoff §20 Q4 — the mapping table is still pending from the ticket
owner.
