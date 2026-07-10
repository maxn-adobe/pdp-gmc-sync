const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount, resolveDataSource, ENVS } = require('../lib/config')
const { mapProduct } = require('../lib/mapProduct')
const { validateRows, MAX_CHUNK } = require('../lib/validate')
const { insertWithRetry } = require('../lib/insertWithRetry')
const { runPool } = require('../lib/concurrency')
const { redact } = require('../lib/redact')
const { errorResponse, checkMissingRequestInputs } = require('../utils')

const DEFAULT_CONCURRENCY = 15

async function main (params) {
  const logger = Core.Logger('sync-products', { level: params.LOG_LEVEL || 'info' })
  logger.debug(redact(params))

  const missing = checkMissingRequestInputs(params, ['env', 'products'], ['Authorization'])
  if (missing) return errorResponse(400, missing, logger)

  if (!ENVS.has(params.env)) {
    return errorResponse(400, "env must be 'test' or 'prod'", logger)
  }
  if (!Array.isArray(params.products) || params.products.length === 0) {
    return errorResponse(400, 'products must be a non-empty array', logger)
  }
  if (params.products.length > MAX_CHUNK) {
    return errorResponse(400, `chunk too large; send <= ${MAX_CHUNK} products per call`, logger)
  }

  let accountId, dataSource, productInputs
  try {
    accountId = resolveAccount(params, params.env)
    dataSource = resolveDataSource(params, params.env, accountId)
    ;({ productInputs } = makeClients(params))
  } catch (e) {
    logger.error(`config/auth error: ${e.message}`)
    return errorResponse(500, 'server misconfigured — see logs', logger)
  }

  const { valid, invalid } = validateRows(params.products)

  const concurrency = Number.isInteger(params.concurrency) && params.concurrency > 0 && params.concurrency <= 50
    ? params.concurrency
    : DEFAULT_CONCURRENCY

  const inserted = await runPool(valid, async (row) => {
    let input
    try {
      input = mapProduct(row)
    } catch (e) {
      return { offerId: row.product_id, ok: false, status: 'MAP_ERROR', message: e.message }
    }
    return insertWithRetry(productInputs, {
      parent: `accounts/${accountId}`,
      dataSource,
      productInput: input
    }, input.offerId, logger)
  }, concurrency)

  const rejected = invalid.map(v => ({
    offerId: v.product_id,
    ok: false,
    status: 'VALIDATION_ERROR',
    message: v.reason
  }))
  const results = [...inserted, ...rejected]
  const succeeded = results.filter(r => r.ok).length

  const body = {
    submitted: params.products.length,
    succeeded,
    failed: results.length - succeeded,
    env: params.env,
    dataSource,
    results
  }
  logger.info(`sync-products env=${params.env} submitted=${body.submitted} ok=${body.succeeded} failed=${body.failed}`)
  return { statusCode: 200, body }
}

module.exports.main = main
