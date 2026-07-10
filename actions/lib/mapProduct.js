const defaults = require('../../config/defaults.json')
const categoryMap = require('../../config/category-map.json')

function toMicros (priceValue, currencyCode = 'USD') {
  const raw = typeof priceValue === 'number'
    ? priceValue
    : parseFloat(String(priceValue ?? '').replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid price: ${priceValue}`)
  return { amountMicros: String(Math.round(raw * 1000000)), currencyCode }
}

function sanitizeOfferId (id) {
  return String(id ?? '').trim().replace(/:/g, '-')
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

  const gpc = categoryMap[row.product_type]
  if (gpc) attrs.googleProductCategory = gpc

  if (row.gtin || (Array.isArray(row.gtins) && row.gtins.length)) {
    attrs.gtins = Array.isArray(row.gtins) ? row.gtins : [row.gtin]
  } else {
    attrs.identifierExists = false
  }

  return {
    offerId,
    contentLanguage: defaults.contentLanguage || 'en',
    feedLabel: defaults.feedLabel || 'US',
    productAttributes: attrs
  }
}

module.exports = { mapProduct, toMicros, sanitizeOfferId }
