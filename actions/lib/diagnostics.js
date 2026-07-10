const { parseGoogleError } = require('./googleError')
const { runPool } = require('./concurrency')

const FEED_LABEL = 'US'
const CONTENT_LANGUAGE = 'en'

function classify (product) {
  const statuses = product?.productStatus?.destinationStatuses || []
  const has = (bucket) => statuses.some(s => Array.isArray(s?.[bucket]) && s[bucket].length > 0)
  if (has('approvedCountries')) return 'active'
  if (has('pendingCountries')) return 'pending'
  if (has('disapprovedCountries')) return 'disapproved'
  return 'unknown'
}

function collectIssues (product) {
  const issues = product?.productStatus?.itemLevelIssues || []
  return issues.map(i => ({
    code: i.code || '',
    severity: i.severity || '',
    resolution: i.resolution || '',
    attribute: i.attribute || '',
    description: i.description || '',
    documentation: i.documentation || ''
  }))
}

async function fetchProductStatus (productsClient, accountId, offerId) {
  const name = `accounts/${accountId}/products/${CONTENT_LANGUAGE}~${FEED_LABEL}~${offerId}`
  try {
    const [product] = await productsClient.getProduct({ name })
    return {
      offerId,
      ok: true,
      status: classify(product),
      issues: collectIssues(product),
      name: product.name
    }
  } catch (err) {
    const p = parseGoogleError(err)
    return { offerId, ok: false, status: 'error', code: p.code, statusCode: p.status, reason: p.reason, message: p.message }
  }
}

async function fetchAllStatuses (productsClient, accountId, offerIds, concurrency = 15) {
  return runPool(offerIds, (id) => fetchProductStatus(productsClient, accountId, id), concurrency)
}

async function searchDisapproved (reportsClient, accountId, pageSize = 1000) {
  const query = "SELECT offer_id, id, title, price, item_issues FROM product_view WHERE aggregated_reporting_context_status = 'NOT_ELIGIBLE_OR_DISAPPROVED'"
  const [rows] = await reportsClient.search({
    parent: `accounts/${accountId}`,
    query,
    pageSize
  })
  return rows
}

function summarize (results) {
  const counts = { active: 0, pending: 0, disapproved: 0, unknown: 0, error: 0 }
  const issueTally = new Map()
  for (const r of results) {
    if (!r.ok) { counts.error++; continue }
    counts[r.status] = (counts[r.status] || 0) + 1
    for (const i of (r.issues || [])) {
      const key = `${i.severity}|${i.code}|${i.attribute}`
      const cur = issueTally.get(key) || { code: i.code, severity: i.severity, attribute: i.attribute, count: 0 }
      cur.count++
      issueTally.set(key, cur)
    }
  }
  const itemIssueTop = [...issueTally.values()].sort((a, b) => b.count - a.count)
  return { counts, itemIssueTop }
}

module.exports = { fetchProductStatus, fetchAllStatuses, searchDisapproved, summarize, classify, collectIssues }
