jest.mock('@adobe/aio-sdk', () => ({
  Core: { Logger: () => ({ debug: () => {}, info: () => {}, error: () => {} }) }
}))
jest.mock('../../actions/lib/gmcClients', () => ({
  makeClients: jest.fn((params) => {
    if (!params.GMC_CLIENT_ID || params.GMC_CLIENT_ID === '__PLACEHOLDER__') {
      throw new Error('GMC credentials not configured')
    }
    return {
      productInputs: { insertProductInput: jest.fn(async () => [{ name: 'accounts/1/productInputs/en~US~x' }]) }
    }
  })
}))

const action = require('../../actions/sync-products/index')

const validEnv = {
  GMC_CLIENT_ID: 'cid',
  GMC_CLIENT_SECRET: 'csec',
  GMC_REFRESH_TOKEN: 'rtok',
  GMC_MERCHANT_ACCOUNT_ID_TEST: '12345',
  GMC_DATASOURCE_ID_TEST: '9876',
  __ow_headers: { authorization: 'Bearer stub' }
}

const goodRow = {
  product_id: 'zaz-1',
  title: 'A thing',
  url_slug: 'print/thing/zaz-1',
  initial_pretty_preferred_view_url: 'https://cdn.example.com/x.png',
  price: '9.99'
}

describe('sync-products action', () => {
  test('400 when env is missing', async () => {
    const res = await action.main({ ...validEnv, products: [goodRow] })
    expect(res.error?.statusCode).toBe(400)
  })

  test('400 when env is not test/prod', async () => {
    const res = await action.main({ ...validEnv, env: 'staging', products: [goodRow] })
    expect(res.error?.statusCode).toBe(400)
  })

  test('400 when Authorization header missing', async () => {
    const { __ow_headers: _, ...noAuth } = validEnv
    const res = await action.main({ ...noAuth, env: 'test', products: [goodRow] })
    expect(res.error?.statusCode).toBe(400)
    expect(res.error.body.error).toMatch(/Authorization/i)
  })

  test('400 when products missing or empty', async () => {
    let res = await action.main({ ...validEnv, env: 'test' })
    expect(res.error?.statusCode).toBe(400)
    res = await action.main({ ...validEnv, env: 'test', products: [] })
    expect(res.error?.statusCode).toBe(400)
  })

  test('400 when chunk exceeds MAX_CHUNK', async () => {
    const products = Array.from({ length: 501 }, (_, i) => ({ ...goodRow, product_id: `p-${i}` }))
    const res = await action.main({ ...validEnv, env: 'test', products })
    expect(res.error?.statusCode).toBe(400)
    expect(res.error.body.error).toMatch(/500/)
  })

  test('happy path returns per-item results', async () => {
    const products = [goodRow, { ...goodRow, product_id: 'zaz-2' }]
    const res = await action.main({ ...validEnv, env: 'test', products })
    expect(res.statusCode).toBe(200)
    expect(res.body.submitted).toBe(2)
    expect(res.body.succeeded).toBe(2)
    expect(res.body.results.length).toBe(2)
  })

  test('validation failures appear in results, do not abort batch', async () => {
    const products = [goodRow, { ...goodRow, product_id: '' }]
    const res = await action.main({ ...validEnv, env: 'test', products })
    expect(res.statusCode).toBe(200)
    expect(res.body.submitted).toBe(2)
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed).toBe(1)
    expect(res.body.results.find(r => r.status === 'VALIDATION_ERROR')).toBeTruthy()
  })

  test('500 when creds are missing (fails closed)', async () => {
    const { GMC_CLIENT_ID: _, ...noCid } = validEnv
    const res = await action.main({ ...noCid, env: 'test', products: [goodRow] })
    expect(res.error?.statusCode).toBe(500)
  })
})
