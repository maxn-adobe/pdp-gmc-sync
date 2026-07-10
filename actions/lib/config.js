const { isPlaceholder } = require('./auth')

const ENVS = new Set(['test', 'prod'])

function resolveAccount (params, env) {
  if (!ENVS.has(env)) throw new Error(`env must be 'test' or 'prod', got: ${JSON.stringify(env)}`)
  const key = env === 'test' ? 'GMC_MERCHANT_ACCOUNT_ID_TEST' : 'GMC_MERCHANT_ACCOUNT_ID_PROD'
  const id = params[key]
  if (isPlaceholder(id)) throw new Error(`Missing ${key} in action params.`)
  return String(id).replace(/^accounts\//, '')
}

function resolveDataSource (params, env, accountId) {
  const key = env === 'test' ? 'GMC_DATASOURCE_ID_TEST' : 'GMC_DATASOURCE_ID_PROD'
  const id = params[key]
  if (isPlaceholder(id)) {
    throw new Error(`Missing ${key} in action params. Run bootstrap-datasource first and populate .env.`)
  }
  const bare = String(id).split('/').pop()
  return `accounts/${accountId}/dataSources/${bare}`
}

module.exports = { resolveAccount, resolveDataSource, ENVS }
