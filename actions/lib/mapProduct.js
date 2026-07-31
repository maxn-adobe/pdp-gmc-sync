const defaults = require('../../config/defaults.json')
const categoryMap = require('../../config/category-map.json')

function toMicros (priceValue, currencyCode = 'USD') {
  const raw = typeof priceValue === 'number'
    ? priceValue
    : parseFloat(String(priceValue ?? '').replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid price: ${priceValue}`)
  return { amountMicros: String(Math.round(raw * 1000000)), currencyCode }
}

// Shared by validate.js (to enforce google_product_category as mandatory)
// and mapProduct() below (to actually set the field) — single source of
// truth for how the value is resolved, so the two never drift apart.
// An explicit row-level value always wins over the category-map lookup.
function resolveGoogleProductCategory (row) {
  if (row.google_product_category != null && String(row.google_product_category).trim()) {
    return String(row.google_product_category).trim()
  }
  return categoryMap[row.product_type] || null
}

function sanitizeOfferId (id) {
  const trimmed = String(id ?? '').trim()
  // Adobe/Zazzle template ids are URNs like "urn:aaid:sc:VA6C2:<uuid>". The
  // "urn:aaid:sc:<catalog>:" segment is a constant namespace tag (identical
  // across every product observed so far), not per-product data, and pushes
  // the sanitized offerId past Google's 50-character `id` limit (confirmed
  // via a live insert: a 54-char offerId was rejected with "Value too long
  // in attribute: id"). Strip it and keep the per-product suffix (a 36-char
  // UUID, comfortably under 50); anything not in this URN shape just falls
  // through to the plain colon-to-hyphen replacement as before.
  const stripped = trimmed.replace(/^urn:aaid:sc:[^:]+:/, '')
  return stripped.replace(/:/g, '-')
}

function mapProduct (row) {
  const offerId = sanitizeOfferId(row.product_id)
  if (!offerId) throw new Error('missing product_id')
  if (!row.link) throw new Error('missing link')

  const rawTitle = String(row.title ?? '')
  const attrs = {
    title: rawTitle.length > 150 ? rawTitle.slice(0, 150) : rawTitle,
    description: row.description == null ? '' : String(row.description),
    link: row.link,
    imageLink: row.initial_pretty_preferred_view_url || row.image_link || '',
    availability: row.availability || defaults.availability || 'IN_STOCK',
    condition: row.condition || defaults.condition || 'NEW',
    brand: row.brand || defaults.brand,
    price: toMicros(row.price ?? row.base_price, defaults.currency || 'USD')
  }

  const gpc = resolveGoogleProductCategory(row)
  if (gpc) attrs.googleProductCategory = gpc

  // Human-readable category label. The v1 ProductAttributes field is the
  // repeated string `productTypes` (there is no singular `productType`
  // field) — see mapProduct.test.js and the PRD note on this mapping.
  if (row.department_name) {
    attrs.productTypes = [`Print > ${row.department_name}`]
  }

  // Only submit a sale price when the row supplies one AND its end date is
  // still in the future at the moment this row is mapped (computed fresh
  // per row, not once for the whole request) — otherwise omit both fields
  // rather than push a stale/expired sale.
  if (row.sale_price != null && row.sale_price_end_date) {
    const now = new Date()
    const endTime = new Date(row.sale_price_end_date)
    if (!Number.isNaN(endTime.getTime()) && endTime.getTime() > now.getTime()) {
      attrs.salePrice = toMicros(row.sale_price, defaults.currency || 'USD')
      // salePriceEffectiveDate is google.type.Interval (startTime/endTime
      // Timestamp sub-messages), not a string — confirmed against
      // products_common.proto:956/957 and verified empirically via
      // ProductAttributes.fromObject() that a plain string throws
      // "object expected" at encode time, while { seconds } round-trips
      // cleanly.
      attrs.salePriceEffectiveDate = {
        startTime: { seconds: Math.floor(now.getTime() / 1000) },
        endTime: { seconds: Math.floor(endTime.getTime() / 1000) }
      }
    }
  }

  // Variant attributes — optional pass-through, only set when the row
  // supplies them. material/color/size match the v1 proto field names
  // exactly. age_group/gender are proto enums (AgeGroup/Gender) whose
  // accepted string values are the UPPER_SNAKE_CASE enum names, so the raw
  // row value (e.g. "adult", "unisex") is upper-cased before assignment —
  // verified empirically that lowercase enum strings are silently dropped
  // by protobufjs.
  if (row.material) attrs.material = row.material
  if (row.color) attrs.color = row.color
  if (row.size) attrs.size = row.size
  if (row.age_group) attrs.ageGroup = String(row.age_group).toUpperCase()
  if (row.gender) attrs.gender = String(row.gender).toUpperCase()

  // custom_label_0 / shipping_label — optional pass-through only, no
  // composition logic (provenance still open per PRD §12.4). The v1 proto's
  // generated camelCase name for custom_label_0 is `customLabel_0` (the
  // underscore before the digit is retained by protobufjs) — verified
  // empirically; `customLabel0` (no underscore) is silently dropped.
  if (row.custom_label_0) attrs.customLabel_0 = row.custom_label_0
  if (row.shipping_label) attrs.shippingLabel = row.shipping_label

  if (row.gtin || (Array.isArray(row.gtins) && row.gtins.length)) {
    attrs.gtins = Array.isArray(row.gtins) ? row.gtins : [row.gtin]
  } else {
    attrs.identifierExists = false
  }

  // printing_type / capacity / minimum_order_quantity have no matching
  // top-level field anywhere in the installed v1 proto (checked v0.9.0,
  // both v1 and v1beta). ProductInput does have a generic escape valve for
  // exactly this situation: `customAttributes` (repeated
  // google.shopping.type.CustomAttribute, a simple { name, value } string
  // pair), a sibling of
  // productAttributes on ProductInput, not nested inside it. Verified
  // empirically via ProductInput.fromObject() that this round-trips
  // cleanly. minimum_order_quantity still defaults to 1 (print-on-demand
  // single unit) when the row omits it, so it is always present; the other
  // two are only included when the row supplies them.
  const customAttributes = []
  if (row.printing_type) customAttributes.push({ name: 'printing_type', value: String(row.printing_type) })
  if (row.capacity) customAttributes.push({ name: 'capacity', value: String(row.capacity) })
  customAttributes.push({
    name: 'minimum_order_quantity',
    value: String(row.minimum_order_quantity != null ? row.minimum_order_quantity : 1)
  })

  return {
    offerId,
    contentLanguage: defaults.contentLanguage || 'en',
    feedLabel: defaults.feedLabel || 'US',
    productAttributes: attrs,
    customAttributes
  }
}

module.exports = { mapProduct, toMicros, sanitizeOfferId, resolveGoogleProductCategory }
