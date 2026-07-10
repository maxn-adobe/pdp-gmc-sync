# config/

## defaults.json
Product-level defaults consumed by `actions/lib/mapProduct.js`. Every `_TODO_*`
key is a placeholder that needs a real value from the ticket owner before
production use — see the top-level `README.md` and handoff §20.

- `pdpBaseUrl` — public canonical PDP base URL. `url_slug` is appended to build
  `productAttributes.link`. **Required — must be replaced before prod.**
- `brand` — static brand string (§20 Q5).
- `availability`, `condition`, `currency`, `feedLabel`, `contentLanguage` —
  applied when a row does not override.

## category-map.json
Zazzle `product_type` → `googleProductCategory`. **Empty by default** — an empty
map is fine: Google auto-assigns a category when the field is omitted (§20 Q4).
Fill in when the ticket owner provides a mapping table, e.g.:

```json
{
  "T-Shirts": "212",
  "Mugs": "2918",
  "Business Cards": "5498"
}
```

Keys must match the exact string in the export's `product_type` column.
