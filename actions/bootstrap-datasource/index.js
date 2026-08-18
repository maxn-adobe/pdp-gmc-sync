const { Core } = require('@adobe/aio-sdk')
const { makeClients } = require('../lib/gmcClients')
const { resolveAccount } = require('../lib/config')
const { redact } = require('../lib/redact')

async function main (params) {
  const logger = Core.Logger('bootstrap-datasource', { level: params.LOG_LEVEL || 'info' })
  logger.debug(redact(params))

  let accountId, dataSources
  try {
    accountId = resolveAccount(params)
    ;({ dataSources } = makeClients(params))
  } catch (e) {
    logger.error(`config/auth error: ${e.message}`)
    return { statusCode: 500, body: { error: e.message } }
  }

  const envLabel = String(params.GMC_ENV).toUpperCase()
  try {
    const [ds] = await dataSources.createDataSource({
      parent: `accounts/${accountId}`,
      dataSource: {
        displayName: `Adobe Express Print Primary Feed (${envLabel})`,
        primaryProductDataSource: {
          contentLanguage: 'en',
          feedLabel: 'US',
          countries: ['US']
        }
      }
    })
    const dataSourceId = ds.name ? ds.name.split('/').pop() : undefined
    logger.info(`Created data source: ${ds.name}`)
    return {
      statusCode: 200,
      body: {
        env: params.GMC_ENV,
        name: ds.name,
        dataSourceId,
        note: 'Store this ID as GMC_DATASOURCE_ID in this workspace\'s deployment secrets (.env.stage / .env.prod)'
      }
    }
  } catch (e) {
    logger.error(`createDataSource failed: ${e.message}`)
    return { statusCode: 502, body: { error: 'failed to create data source', detail: e.message } }
  }
}

module.exports.main = main
