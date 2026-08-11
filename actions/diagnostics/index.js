const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount, resolveDataSource, ENVS } = require('../lib/config')
const { searchProductDiagnostics, summarizeProductDiagnostics } = require('../lib/diagnostics')
const { postSlack, formatDigest } = require('../lib/slack')
const { isValidImsToken } = require('../lib/imsAuth')
const { redact } = require('../lib/redact')
const { errorResponse, checkMissingRequestInputs } = require('../utils')

async function main (params) {
  const logger = Core.Logger('diagnostics', { level: params.LOG_LEVEL || 'info' })
  logger.debug(redact(params))

  const missing = checkMissingRequestInputs(params, ['env'], ['Authorization'])
  if (missing) return errorResponse(400, missing, logger)

  if (!ENVS.has(params.env)) {
    return errorResponse(400, "env must be 'test' or 'prod'", logger)
  }

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
    accountId = resolveAccount(params, params.env)
    dataSource = resolveDataSource(params, params.env, accountId)
    clients = makeClients(params)
  } catch (e) {
    logger.error(`config/auth error: ${e.message}`)
    return errorResponse(500, 'server misconfigured — see logs', logger)
  }

  const requestedOfferIds = Array.isArray(params.offerIds)
    ? [...new Set(params.offerIds.filter(Boolean).map(String))]
    : []
  const offerIds = requestedOfferIds.length ? requestedOfferIds : null
  if (offerIds && offerIds.length > 5000) {
    return errorResponse(400, 'offerIds too large; keep <= 5000 per diagnostics call', logger)
  }

  const report = {
    env: params.env,
    accountId,
    dataSource,
    offerCount: 0,
    counts: { active: 0, limited: 0, pending: 0, disapproved: 0, unknown: 0, error: 0 },
    itemIssueTop: [],
    results: []
  }

  try {
    const results = await searchProductDiagnostics(
      clients.reports,
      clients.products,
      accountId,
      dataSource,
      offerIds
    )
    const { counts, itemIssueTop } = summarizeProductDiagnostics(results)
    report.offerCount = results.length
    report.counts = counts
    report.itemIssueTop = itemIssueTop
    report.results = results
    if (offerIds) {
      const returnedOfferIds = new Set(results.map(product => String(product.offerId)))
      report.requestedOfferCount = offerIds.length
      report.missingOfferIds = offerIds.filter(offerId => !returnedOfferIds.has(offerId))
    }
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

module.exports.main = main
