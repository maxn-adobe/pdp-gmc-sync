const RUN = process.env.GMC_RUN_INTEGRATION === '1'
const describeIf = RUN ? describe : describe.skip

const paramsFromEnv = () => ({
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  GMC_SERVICE_ACCOUNT_JSON: process.env.GMC_SERVICE_ACCOUNT_JSON,
  GMC_GCP_PROJECT_ID: process.env.GMC_GCP_PROJECT_ID,
  GMC_MERCHANT_ACCOUNT_ID_TEST: process.env.GMC_MERCHANT_ACCOUNT_ID_TEST,
  GMC_DATASOURCE_ID_TEST: process.env.GMC_DATASOURCE_ID_TEST,
  __ow_headers: { authorization: 'Bearer test' }
})

const sampleRow = {
  product_id: `int-test-${Date.now()}`,
  title: 'Integration test product',
  description: 'Ignore — created by automated integration tests',
  link: 'https://www.adobe.com/express/print/business-card/integration-test-product',
  initial_pretty_preferred_view_url: 'https://cdn.example.com/int-test.png',
  price: '9.99',
  product_type: 'zazzle_integration_test'
}

describeIf('sync-products :: integration (test account)', () => {
  jest.setTimeout(60000)

  test('inserts a single product and returns per-item success', async () => {
    const { main } = require('../../actions/sync-products/index')
    const res = await main({ ...paramsFromEnv(), env: 'test', products: [sampleRow] })
    expect(res.statusCode).toBe(200)
    expect(res.body.submitted).toBe(1)
    expect(res.body.succeeded).toBe(1)
    expect(res.body.results[0].name).toMatch(/^accounts\/.+\/productInputs\/en~US~/)
  })

  test('idempotent: re-inserting the same offerId still succeeds', async () => {
    const { main } = require('../../actions/sync-products/index')
    const res = await main({ ...paramsFromEnv(), env: 'test', products: [sampleRow] })
    expect(res.body.succeeded).toBe(1)
  })
})
