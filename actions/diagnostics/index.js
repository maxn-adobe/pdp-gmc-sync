const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount, resolveDataSource } = require('../lib/config')
const { searchProductDiagnostics, summarizeProductDiagnostics } = require('../lib/diagnostics')
const { initState, clearPushes } = require('../lib/syncState')
const { postSlack, formatDigest } = require('../lib/slack')
const { isValidImsToken } = require('../lib/imsAuth')
const { redact } = require('../lib/redact')
const { errorResponse, checkMissingRequestInputs } = require('../utils')

const MAX_EXPLICIT_OFFER_IDS = 100
const MAX_INLINE_RESPONSE_BYTES = 1024 * 1024

function normalizeOfferIds (input) {
  if (input == null) return []
  let values = Array.isArray(input) ? input : [input]
  if (values.length === 1 && typeof values[0] === 'string') {
    const packed = values[0].trim()
    if (packed.startsWith('[')) {
      try {
        const parsed = JSON.parse(packed)
        if (Array.isArray(parsed)) values = parsed
      } catch {
        // Fall through to comma-separated action parameter handling.
      }
    }
    if (values.length === 1 && typeof values[0] === 'string' && values[0].includes(',')) {
      values = values[0].split(',')
    }
  }
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))]
}

async function main (params) {
  const logger = Core.Logger('diagnostics', { level: params.LOG_LEVEL || 'info' })
  logger.debug(redact(params))

  const missing = checkMissingRequestInputs(params, [], ['Authorization'])
  if (missing) return errorResponse(400, missing, logger)

  try {
    if (!(await isValidImsToken(params))) {
      return errorResponse(401, 'invalid IMS token', logger)
    }
  } catch {
    logger.error('IMS token validation request failed')
    return errorResponse(503, 'unable to validate IMS token', logger)
  }

  let accountId, dataSource, clients
  try {
    accountId = resolveAccount(params)
    dataSource = resolveDataSource(params, accountId)
    clients = makeClients(params)
  } catch (e) {
    logger.error(`config/auth error: ${e.message}`)
    return errorResponse(500, 'server misconfigured — see logs', logger)
  }

  const requestedOfferIds = normalizeOfferIds(params.offerIds)
  const offerIds = requestedOfferIds.length ? requestedOfferIds : null
  if (offerIds && offerIds.length > MAX_EXPLICIT_OFFER_IDS) {
    return errorResponse(400, `offerIds too large; keep <= ${MAX_EXPLICIT_OFFER_IDS} per diagnostics call`, logger)
  }

  const report = {
    env: params.GMC_ENV,
    accountId,
    dataSource,
    offerCount: 0,
    counts: { active: 0, limited: 0, pending: 0, disapproved: 0, unknown: 0, error: 0 },
    itemIssueTop: [],
    results: []
  }

  try {
    const statePromise = initState(logger)
    const results = await searchProductDiagnostics(
      clients.reports,
      clients.products,
      accountId,
      dataSource,
      offerIds
    )
    if (offerIds) {
      const returnedOfferIds = new Set(results.map(product => String(product.offerId)))
      report.requestedOfferCount = offerIds.length
      report.missingOfferIds = offerIds.filter(offerId => !returnedOfferIds.has(offerId))
    }
    const { counts, itemIssueTop } = summarizeProductDiagnostics(results)
    report.offerCount = results.length
    report.counts = counts
    report.itemIssueTop = itemIssueTop
    report.results = results

    const responseBytes = Buffer.byteLength(JSON.stringify({ statusCode: 200, body: report }))
    if (responseBytes > MAX_INLINE_RESPONSE_BYTES) {
      logger.error(`diagnostics response too large: ${responseBytes} bytes`)
      return errorResponse(
        413,
        offerIds
          ? `diagnostics response is too large (${responseBytes} bytes); retry with fewer offerIds`
          : `diagnostics response is too large (${responseBytes} bytes); request up to ${MAX_EXPLICIT_OFFER_IDS} offerIds instead of a full data-source sweep`,
        logger
      )
    }

    const state = await statePromise
    await clearPushes(
      state,
      params.GMC_ENV,
      accountId,
      results.map(product => product.offerId).filter(Boolean),
      logger
    )
  } catch (e) {
    logger.error(`diagnostics fetch failed: ${e.message}`)
    return errorResponse(502, 'failed to read from Merchant Center', logger)
  }

  const digest = formatDigest(report)
  logger.info(digest)
  try {
    await postSlack(params.SLACK_WEBHOOK_URL, digest)
  } catch (e) {
    logger.error(`slack post failed: ${e.message}`)
  }

  return { statusCode: 200, body: report }
}

module.exports = {
  main,
  normalizeOfferIds,
  MAX_EXPLICIT_OFFER_IDS,
  MAX_INLINE_RESPONSE_BYTES
}
