jest.mock('@adobe/aio-sdk', () => ({
  Core: { Logger: () => ({ debug: () => {}, info: () => {}, error: () => {} }) }
}))

const mockValidateToken = jest.fn(async token => ({ valid: token === 'stub' }))
const mockValidateTokenAllowList = jest.fn(async token => ({ valid: token === 'stub' }))
const mockGetTokenData = jest.fn(() => ({
  as: 'ims-na1',
  client_id: '<da.live client_id>',
  type: 'access_token'
}))
jest.mock('@adobe/aio-lib-ims', () => ({
  Ims: jest.fn(() => ({
    validateToken: mockValidateToken,
    validateTokenAllowList: mockValidateTokenAllowList
  })),
  getTokenData: mockGetTokenData
}))

const mockMakeClients = jest.fn(() => ({ reports: {} }))
jest.mock('../../actions/lib/gmcClients', () => ({ makeClients: mockMakeClients }))
jest.mock('../../actions/lib/config', () => ({
  ENVS: new Set(['test', 'prod']),
  resolveAccount: jest.fn(() => '12345')
}))

const mockSearchDisapproved = jest.fn(async () => [])
jest.mock('../../actions/lib/diagnostics', () => ({
  fetchAllStatuses: jest.fn(),
  searchDisapproved: mockSearchDisapproved,
  summarize: jest.fn()
}))
jest.mock('../../actions/lib/syncState', () => ({ initState: jest.fn(async () => null) }))
jest.mock('../../actions/lib/slack', () => ({
  postSlack: jest.fn(async () => {}),
  formatDigest: jest.fn(() => 'digest')
}))
jest.mock('../../actions/lib/redact', () => ({ redact: jest.fn(() => '{}') }))

const action = require('../../actions/diagnostics/index')

const validParams = {
  env: 'test',
  __ow_headers: { authorization: 'Bearer stub' }
}

describe('diagnostics action IMS authorization', () => {
  beforeEach(() => {
    mockValidateToken.mockClear()
    mockValidateTokenAllowList.mockClear()
    mockGetTokenData.mockClear()
    mockMakeClients.mockClear()
    mockSearchDisapproved.mockClear()
  })

  test('validates the bearer token before reading Merchant Center', async () => {
    const res = await action.main(validParams)
    expect(res.statusCode).toBe(200)
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('stub', ['<da.live client_id>'])
    expect(mockMakeClients).toHaveBeenCalledTimes(1)
    expect(mockSearchDisapproved).toHaveBeenCalledTimes(1)
  })

  test('returns 401 without creating GMC clients for an invalid token', async () => {
    mockValidateTokenAllowList.mockResolvedValueOnce({ valid: false })
    const res = await action.main(validParams)
    expect(res.error?.statusCode).toBe(401)
    expect(res.error.body.error).toBe('invalid IMS token')
    expect(mockMakeClients).not.toHaveBeenCalled()
  })

  test('returns 503 without creating GMC clients when IMS is unavailable', async () => {
    mockValidateTokenAllowList.mockRejectedValueOnce(new Error('IMS unavailable'))
    const res = await action.main(validParams)
    expect(res.error?.statusCode).toBe(503)
    expect(res.error.body.error).toBe('unable to validate IMS token')
    expect(mockMakeClients).not.toHaveBeenCalled()
  })
})