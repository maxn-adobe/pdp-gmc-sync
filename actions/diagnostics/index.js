const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount, ENVS } = require('../lib/config')
const { fetchAllStatuses, searchDisapproved, summarize } = require('../lib/diagnostics')
const { initState } = require('../lib/syncState')
const { postSlack, formatDigest } = require('../lib/slack')
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

  let accountId, clients
  try {
    accountId = resolveAccount(params, params.env)
    clients = makeClients(params)
  } catch (e) {
    logger.error(`config/auth error: ${e.message}`)
    return errorResponse(500, 'server misconfigured — see logs', logger)
  }

  const offerIds = Array.isArray(params.offerIds) ? params.offerIds.filter(Boolean).map(String) : null
  if (offerIds && offerIds.length > 5000) {
    return errorResponse(400, 'offerIds too large; keep <= 5000 per diagnostics call', logger)
  }

  const report = { env: params.env, accountId, offerCount: 0, counts: { active: 0, pending: 0, disapproved: 0, unknown: 0, error: 0 }, itemIssueTop: [], results: [] }

  const state = await initState(logger)

  try {
    if (offerIds && offerIds.length) {
      const results = await fetchAllStatuses(clients.products, accountId, offerIds, state, params.env)
      const { counts, itemIssueTop } = summarize(results)
      report.offerCount = results.length
      report.counts = counts
      report.itemIssueTop = itemIssueTop
      report.results = results
    } else {
      const rows = await searchDisapproved(clients.reports, accountId)
      report.offerCount = rows.length
      report.counts.disapproved = rows.length
      report.disapprovedSample = rows.slice(0, 50)
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
