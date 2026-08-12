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

function aggregatedStatusFromProduct (product) {
  const statuses = product?.productStatus?.destinationStatuses || []
  const hasCountries = field => statuses.some(status => status[field]?.length)
  const approved = hasCountries('approvedCountries')
  const pending = hasCountries('pendingCountries')
  const disapproved = hasCountries('disapprovedCountries')
  if (approved && disapproved) return 'ELIGIBLE_LIMITED'
  if (approved) return 'ELIGIBLE'
  if (pending) return 'PENDING'
  if (disapproved) return 'NOT_ELIGIBLE_OR_DISAPPROVED'
  return 'AGGREGATED_REPORTING_CONTEXT_STATUS_UNSPECIFIED'
}

function productIssueSeverity (severity) {
  if (typeof severity !== 'number') return severity || ''
  return ({ 1: 'NOT_IMPACTED', 2: 'DEMOTED', 3: 'DISAPPROVED' })[severity] || String(severity)
}

function productIssueToDiagnostic (issue) {
  const severity = productIssueSeverity(issue.severity)
  const countries = issue.applicableCountries || []
  const perContext = issue.reportingContext
    ? [{
        reportingContext: issue.reportingContext,
        disapprovedCountries: severity === 'DISAPPROVED' ? countries : [],
        demotedCountries: severity === 'DEMOTED' ? countries : []
      }]
    : []
  return {
    type: {
      code: issue.code || '',
      canonicalAttribute: issue.attribute || ''
    },
    severity: {
      aggregatedSeverity: severity,
      severityPerReportingContext: perContext
    },
    resolution: String(issue.resolution || '').toUpperCase()
  }
}

function productToDiagnostic (rawProduct) {
  const product = plainProductView(rawProduct)
  const attributes = product.productAttributes || {}
  const productStatus = product.productStatus || {}
  return {
    id: productIdFromName(product.name),
    offerId: product.offerId,
    languageCode: product.contentLanguage,
    feedLabel: product.feedLabel,
    title: attributes.title,
    brand: attributes.brand,
    price: attributes.price,
    condition: attributes.condition,
    availability: attributes.availability,
    shippingLabel: attributes.shippingLabel,
    gtin: attributes.gtins || [],
    itemGroupId: attributes.itemGroupId,
    aggregatedReportingContextStatus: aggregatedStatusFromProduct(product),
    statusPerReportingContext: productStatus.destinationStatuses || [],
    itemIssues: (productStatus.itemLevelIssues || []).map(productIssueToDiagnostic),
    dataSource: product.dataSource,
    diagnosticSource: 'products'
  }
}

async function listDataSourceProducts (productsClient, accountId, dataSource, offerIds) {
  const requested = offerIds?.length ? new Set(offerIds.map(String)) : null
  const found = new Set()
  const matches = []
  let pageToken
  do {
    const [products, , response] = await productsClient.listProducts({
      parent: `accounts/${accountId}`,
      pageSize: PRODUCT_LIST_PAGE_SIZE,
      pageToken
    }, { autoPaginate: false })
    for (const product of products) {
      const offerId = String(product.offerId)
      if (product.dataSource === dataSource && (!requested || requested.has(offerId))) {
        matches.push(product)
        found.add(offerId)
      }
    }
    if (requested && found.size === requested.size) break
    pageToken = response?.nextPageToken || null
  } while (pageToken)
  return matches
}

async function listDataSourceProductIds (productsClient, accountId, dataSource, offerIds) {
  const products = await listDataSourceProducts(productsClient, accountId, dataSource, offerIds)
  return [...new Set(products
    .map(product => productIdFromName(product.name))
    .filter(Boolean))]
}

async function diagnosticsForProducts (reportsClient, accountId, products) {
  const productsById = new Map(products
    .map(product => [productIdFromName(product.name), product])
    .filter(([id]) => id))
  const productIds = [...productsById.keys()]
  const productViewsById = new Map()
  for (let index = 0; index < productIds.length; index += REPORT_ID_BATCH_SIZE) {
    const batch = productIds.slice(index, index + REPORT_ID_BATCH_SIZE)
    const query = buildProductDiagnosticsQuery(batch)
    let pageToken
    do {
      const [rows, , response] = await reportsClient.search({
        parent: `accounts/${accountId}`,
        query,
        pageSize: REPORT_PAGE_SIZE,
        pageToken
      }, { autoPaginate: false })
      for (const row of rows) {
        if (row.productView) {
          const productView = plainProductView(row.productView)
          productViewsById.set(productView.id, { ...productView, diagnosticSource: 'reports' })
        }
      }
      pageToken = response?.nextPageToken || null
    } while (pageToken)
  }
  const productViews = productIds.map(id => (
    productViewsById.get(id) || productToDiagnostic(productsById.get(id))
  ))
  return productViews.sort((a, b) => String(a.offerId || '').localeCompare(String(b.offerId || '')))
}

async function searchProductDiagnostics (reportsClient, productsClient, accountId, dataSource, offerIds) {
  const products = await listDataSourceProducts(productsClient, accountId, dataSource, offerIds)
  return diagnosticsForProducts(reportsClient, accountId, products)
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

module.exports = {
  searchProductDiagnostics,
  buildProductDiagnosticsQuery,
  listDataSourceProducts,
  listDataSourceProductIds,
  productToDiagnostic,
  summarizeProductDiagnostics,
  classifyProductView,
  PRODUCT_DIAGNOSTIC_FIELDS
}
