const defaults = require('../../config/defaults.json')
const { sanitizeOfferId, resolveGoogleProductCategory } = require('./mapProduct')

const MAX_CHUNK = 50
const MAX_TITLE = 150
const MAX_DESCRIPTION = 5000
const MAX_URL = 2000
const MAX_PRODUCT_ID = 200
// Google's real hard limit on the `id`/offerId attribute, confirmed via a live
// insert rejection ("Value too long in attribute: id")
const MAX_OFFER_ID = 50

const ALLOWED_HOSTS = new Set(defaults.pdpAllowedHosts || [])

function isNonEmptyString (v, max) {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s) return false
  if (max && s.length > max) return false
  return true
}

function isValidPrice (v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0
  if (typeof v !== 'string') return false
  const cleaned = v.replace(/[^0-9.\-]/g, '')
  if (!cleaned) return false
  const num = parseFloat(cleaned)
  return Number.isFinite(num) && num >= 0
}

function validateLink (link) {
  if (!isNonEmptyString(link, MAX_URL)) return 'link missing or invalid'
  let url
  try { url = new URL(link) } catch (e) { return 'link is not a valid URL' }
  if (url.protocol !== 'https:') return 'link must be https'
  if (!ALLOWED_HOSTS.has(url.hostname)) return `link host not in allowlist: ${url.hostname}`
  return null
}

function validateRow (row) {
  if (!row || typeof row !== 'object') return 'row is not an object'
  if (!isNonEmptyString(row.product_id, MAX_PRODUCT_ID)) return 'product_id missing or invalid'
  const offerId = sanitizeOfferId(row.product_id)
  if (offerId.length > MAX_OFFER_ID) {
    return `product_id too long once sanitized to offerId (${offerId.length} > ${MAX_OFFER_ID} chars): ${offerId}`
  }
  if (!isNonEmptyString(row.title, MAX_TITLE * 4)) return 'title missing or invalid'
  const linkErr = validateLink(row.link)
  if (linkErr) return linkErr
  const image = row.initial_pretty_preferred_view_url || row.image_link
  if (!isNonEmptyString(image, MAX_URL)) return 'image (initial_pretty_preferred_view_url or image_link) missing or invalid'
  if (image && !/^https?:\/\//i.test(image)) return 'image link must be an http(s) URL'
  const price = row.price ?? row.base_price
  if (!isValidPrice(price)) return 'price missing or invalid'
  if (!isNonEmptyString(row.description, MAX_DESCRIPTION)) return 'description missing or invalid'
  if (!resolveGoogleProductCategory(row)) {
    return row.product_type
      ? `google_product_category could not be resolved for product_type "${row.product_type}" — add it to config/category-map.json, or supply google_product_category directly on the row`
      : 'google_product_category missing — supply product_type (mapped in config/category-map.json) or google_product_category directly on the row'
  }
  return null
}

function validateRows (rows) {
  const valid = []
  const invalid = []
  for (const row of rows) {
    const err = validateRow(row)
    if (err) {
      invalid.push({ product_id: row?.product_id, reason: err })
    } else {
      valid.push(row)
    }
  }
  return { valid, invalid }
}

module.exports = { validateRow, validateRows, validateLink, MAX_CHUNK }
