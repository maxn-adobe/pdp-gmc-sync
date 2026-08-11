const { parseGoogleError } = require('./googleError')
const { runPool } = require('./concurrency')
const { isStale, getPushedAt } = require('./syncState')

const FEED_LABEL = 'US'
const CONTENT_LANGUAGE = 'en'

// Google documents "several minutes" for a freshly-submitted offer to
// become visible via products.get. A NOT_FOUND within this window of our
// last recorded push is normal propagation delay, not a real failure —
// well short of syncState.js's 24h TTL, which just bounds how long we
// keep the record around at all.
const PROPAGATION_WINDOW_MS = 45 * 60 * 1000
const PRODUCT_LIST_PAGE_SIZE = 1000
const REPORT_PAGE_SIZE = 1000
const REPORT_ID_BATCH_SIZE = 250

const PRODUCT_DIAGNOSTIC_FIELDS = [
  'id',
  'channel',
  'language_code',
  'feed_label',
  'offer_id',
  'title',
  'brand',
  'category_l1',
  'category_l2',
  'category_l3',
  'category_l4',
  'category_l5',
  'product_type_l1',
  'product_type_l2',
  'product_type_l3',
  'product_type_l4',
  'product_type_l5',
  'price',
  'condition',
  'availability',
  'shipping_label',
  'gtin',
  'item_group_id',
  'thumbnail_link',
  'creation_time',
  'expiration_date',
  'aggregated_reporting_context_status',
  'status_per_reporting_context',
  'item_issues',
  'click_potential',
  'click_potential_rank'
]

function productIdFromName (name) {
  const marker = '/products/'
  const index = String(name || '').indexOf(marker)
  return index === -1 ? null : String(name).slice(index + marker.length)
}

function quoteMcqlString (value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function buildProductDiagnosticsQuery (productIds) {
  if (!productIds.length) throw new Error('productIds must not be empty')
  return [
    'SELECT',
    `  ${PRODUCT_DIAGNOSTIC_FIELDS.join(',\n  ')}`,
    'FROM product_view',
    `WHERE id IN (${productIds.map(quoteMcqlString).join(', ')})`,
    'ORDER BY offer_id'
  ].join('\n')
}

function plainProductView (view) {
  if (view && typeof view.toJSON === 'function') return view.toJSON()
  return JSON.parse(JSON.stringify(view || {}))
}

async function listDataSourceProductIds (productsClient, accountId, dataSource, offerIds) {
  const [products] = await productsClient.listProducts({
    parent: `accounts/${accountId}`,
    pageSize: PRODUCT_LIST_PAGE_SIZE
  })
  const requested = offerIds?.length ? new Set(offerIds.map(String)) : null
  return [...new Set(products
    .filter(product => product.dataSource === dataSource)
    .filter(product => !requested || requested.has(String(product.offerId)))
    .map(product => productIdFromName(product.name))
    .filter(Boolean))]
}

async function searchProductDiagnostics (reportsClient, productsClient, accountId, dataSource, offerIds) {
  const productIds = await listDataSourceProductIds(productsClient, accountId, dataSource, offerIds)
  const productViews = []
  for (let index = 0; index < productIds.length; index += REPORT_ID_BATCH_SIZE) {
    const batch = productIds.slice(index, index + REPORT_ID_BATCH_SIZE)
    const [rows] = await reportsClient.search({
      parent: `accounts/${accountId}`,
      query: buildProductDiagnosticsQuery(batch),
      pageSize: REPORT_PAGE_SIZE
    })
    for (const row of rows) {
      if (row.productView) productViews.push(plainProductView(row.productView))
    }
  }
  return productViews.sort((a, b) => String(a.offerId || '').localeCompare(String(b.offerId || '')))
}

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

// True if we have a record of pushing this offerId ourselves within the
// propagation window — i.e. a NOT_FOUND from products.get right now is
// expected, not anomalous. Fails open (false) on any missing/unparseable
// data or a State outage, same as isStale in actions/lib/syncState.js.
async function isRecentlyPushed (state, env, accountId, offerId, logger) {
  const pushedAt = await getPushedAt(state, env, accountId, offerId, logger)
  if (pushedAt == null) return false
  const withinWindow = Date.now() - pushedAt < PROPAGATION_WINDOW_MS
  return withinWindow
}

async function fetchProductStatus (productsClient, accountId, offerId, state, env, logger) {
  const name = `accounts/${accountId}/products/${CONTENT_LANGUAGE}~${FEED_LABEL}~${offerId}`
  try {
    const [product] = await productsClient.getProduct({ name })
    const result = {
      offerId,
      ok: true,
      status: classify(product),
      issues: collectIssues(product),
      name: product.name
    }
    // Never replaces `status` — just flags that this particular value may be
    // a stale leftover from before the caller's last push, not Google's
    // verdict on the current data (see actions/lib/syncState.js).
    if (await isStale(state, env, accountId, offerId, product, logger)) {
      result.stale = true
    }
    return result
  } catch (err) {
    const p = parseGoogleError(err)
    if (p.status === 'NOT_FOUND' && await isRecentlyPushed(state, env, accountId, offerId, logger)) {
      return { offerId, ok: true, status: 'pending', stale: true }
    }
    return { offerId, ok: false, status: 'error', code: p.code, statusCode: p.status, reason: p.reason, message: p.message }
  }
}

async function fetchAllStatuses (productsClient, accountId, offerIds, state, env, concurrency = 15, logger) {
  return runPool(offerIds, (id) => fetchProductStatus(productsClient, accountId, id, state, env, logger), concurrency)
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

function classifyProductView (productView) {
  const status = productView?.aggregatedReportingContextStatus
  if (status === 'ELIGIBLE' || status === 4) return 'active'
  if (status === 'ELIGIBLE_LIMITED' || status === 3) return 'limited'
  if (status === 'PENDING' || status === 2) return 'pending'
  if (status === 'NOT_ELIGIBLE_OR_DISAPPROVED' || status === 1) return 'disapproved'
  return 'unknown'
}

function reportEnumName (value, values) {
  if (typeof value === 'number') return values[value] || String(value)
  return value || ''
}

function summarizeProductDiagnostics (productViews) {
  const counts = { active: 0, limited: 0, pending: 0, disapproved: 0, unknown: 0, error: 0 }
  const issueTally = new Map()
  for (const productView of productViews) {
    const status = classifyProductView(productView)
    counts[status]++
    for (const issue of (productView.itemIssues || [])) {
      const code = issue.type?.code || ''
      const attribute = issue.type?.canonicalAttribute || ''
      const severity = reportEnumName(issue.severity?.aggregatedSeverity, {
        1: 'DISAPPROVED',
        2: 'DEMOTED',
        3: 'PENDING'
      })
      const resolution = reportEnumName(issue.resolution, {
        1: 'MERCHANT_ACTION',
        2: 'PENDING_PROCESSING'
      })
      const key = `${severity}|${code}|${attribute}|${resolution}`
      const current = issueTally.get(key) || { code, severity, resolution, attribute, count: 0 }
      current.count++
      issueTally.set(key, current)
    }
  }
  const itemIssueTop = [...issueTally.values()].sort((a, b) => b.count - a.count)
  return { counts, itemIssueTop }
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

module.exports = {
  fetchProductStatus,
  fetchAllStatuses,
  searchDisapproved,
  searchProductDiagnostics,
  buildProductDiagnosticsQuery,
  listDataSourceProductIds,
  summarizeProductDiagnostics,
  classifyProductView,
  summarize,
  classify,
  collectIssues,
  PRODUCT_DIAGNOSTIC_FIELDS
}
