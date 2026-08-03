const RUN_BOOTSTRAP = process.env.GMC_RUN_INTEGRATION === '1' && process.env.GMC_RUN_BOOTSTRAP === '1'
const describeIf = RUN_BOOTSTRAP ? describe : describe.skip

const paramsFromEnv = () => ({
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  GMC_SERVICE_ACCOUNT_JSON: process.env.GMC_SERVICE_ACCOUNT_JSON,
  GMC_GCP_PROJECT_ID: process.env.GMC_GCP_PROJECT_ID,
  GMC_MERCHANT_ACCOUNT_ID_TEST: process.env.GMC_MERCHANT_ACCOUNT_ID_TEST
})

describeIf('bootstrap-datasource :: integration (destructive, opt-in)', () => {
  jest.setTimeout(60000)

  test('creates a data source in the test account', async () => {
    const { main } = require('../../actions/bootstrap-datasource/index')
    const res = await main({ ...paramsFromEnv(), env: 'test' })
    expect(res.statusCode).toBe(200)
    expect(res.body.dataSourceId).toBeTruthy()
    expect(res.body.name).toMatch(/^accounts\/.+\/dataSources\/.+/)
  })
})
