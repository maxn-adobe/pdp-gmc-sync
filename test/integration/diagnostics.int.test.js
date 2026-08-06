const RUN = process.env.GMC_RUN_INTEGRATION === '1'
const describeIf = RUN ? describe : describe.skip

const imsAuthorization = () => {
  if (!process.env.IMS_TOKEN) throw new Error('IMS_TOKEN is required for integration tests')
  return `Bearer ${process.env.IMS_TOKEN}`
}

const paramsFromEnv = () => ({
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  GMC_CLIENT_ID: process.env.GMC_CLIENT_ID,
  GMC_CLIENT_SECRET: process.env.GMC_CLIENT_SECRET,
  GMC_REFRESH_TOKEN: process.env.GMC_REFRESH_TOKEN,
  GMC_SERVICE_ACCOUNT_JSON: process.env.GMC_SERVICE_ACCOUNT_JSON,
  GMC_MERCHANT_ACCOUNT_ID_TEST: process.env.GMC_MERCHANT_ACCOUNT_ID_TEST,
  GMC_DATASOURCE_ID_TEST: process.env.GMC_DATASOURCE_ID_TEST,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
  __ow_headers: { authorization: imsAuthorization() }
})

describeIf('diagnostics :: integration (test account)', () => {
  jest.setTimeout(60000)

  test('reports.search runs and returns a report body', async () => {
    const { main } = require('../../actions/diagnostics/index')
    const res = await main({ ...paramsFromEnv(), env: 'test' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('counts')
    expect(res.body).toHaveProperty('env', 'test')
  })

  test('per-offerId path returns per-product status', async () => {
    const { main } = require('../../actions/diagnostics/index')
    const res = await main({ ...paramsFromEnv(), env: 'test', offerIds: ['does-not-exist'] })
    expect(res.statusCode).toBe(200)
    expect(res.body.results?.length).toBe(1)
    expect(['error', 'active', 'pending', 'disapproved', 'unknown']).toContain(res.body.results[0].status)
  })
})
