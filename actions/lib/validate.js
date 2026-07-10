const MAX_CHUNK = 500
const MAX_TITLE = 150
const MAX_DESCRIPTION = 5000
const MAX_URL = 2000

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

function validateRow (row) {
  if (!row || typeof row !== 'object') return 'row is not an object'
  if (!isNonEmptyString(row.product_id, 100)) return 'product_id missing or invalid'
  if (!isNonEmptyString(row.title, MAX_TITLE * 4)) return 'title missing or invalid'
  if (!isNonEmptyString(row.url_slug, MAX_URL)) return 'url_slug missing or invalid'
  const image = row.initial_pretty_preferred_view_url || row.image_link
  if (!isNonEmptyString(image, MAX_URL)) return 'image (initial_pretty_preferred_view_url or image_link) missing or invalid'
  if (image && !/^https?:\/\//i.test(image)) return 'image link must be an http(s) URL'
  const price = row.price ?? row.base_price
  if (!isValidPrice(price)) return 'price missing or invalid'
  if (row.description !== undefined && row.description !== null && typeof row.description !== 'string') {
    return 'description must be a string when present'
  }
  if (typeof row.description === 'string' && row.description.length > MAX_DESCRIPTION) {
    return 'description too long'
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

module.exports = { validateRow, validateRows, MAX_CHUNK }
