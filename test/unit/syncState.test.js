const mockGet = jest.fn()
const mockPut = jest.fn()

jest.mock('@adobe/aio-lib-state', () => ({
  init: jest.fn(() => Promise.resolve({ get: mockGet, put: mockPut }))
}))

const stateLib = require('@adobe/aio-lib-state')
const { initState, recordPushes, isStale, pushedAtKey, TTL_SECONDS } = require('../../actions/lib/syncState')

const okProduct = (lastUpdateDate) => ({ productStatus: { lastUpdateDate } })

describe('pushedAtKey', () => {
  test('namespaces by env, account, and offerId', () => {
    expect(pushedAtKey('test', '123', 'abc')).toBe('pushed_at:test:123:abc')
  })
})

describe('initState', () => {
  beforeEach(() => { stateLib.init.mockClear() })

  test('returns the initialized client on success', async () => {
    const state = await initState()
    expect(state).toEqual({ get: mockGet, put: mockPut })
  })

  test('fails open (returns null) when State.init throws, without letting the error escape', async () => {
    stateLib.init.mockRejectedValueOnce(new Error('no credentials'))
    const logger = { error: jest.fn() }
    const state = await initState(logger)
    expect(state).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no credentials'))
  })
})

describe('recordPushes', () => {
  beforeEach(() => { mockPut.mockClear() })

  test('does nothing when state is null (fail open)', async () => {
    await recordPushes(null, 'test', '123', ['abc'])
    expect(mockPut).not.toHaveBeenCalled()
  })

  test('does nothing when offerIds is empty', async () => {
    const state = { put: mockPut }
    await recordPushes(state, 'test', '123', [])
    expect(mockPut).not.toHaveBeenCalled()
  })

  test('puts one entry per offerId with the shared key format and TTL', async () => {
    mockPut.mockResolvedValue('ok')
    const state = { put: mockPut }
    await recordPushes(state, 'test', '123', ['abc', 'def'])
    expect(mockPut).toHaveBeenCalledTimes(2)
    expect(mockPut).toHaveBeenCalledWith('pushed_at:test:123:abc', expect.any(String), { ttl: TTL_SECONDS })
    expect(mockPut).toHaveBeenCalledWith('pushed_at:test:123:def', expect.any(String), { ttl: TTL_SECONDS })
  })

  test('logs but does not throw when a put rejects', async () => {
    mockPut.mockRejectedValueOnce(new Error('state unavailable'))
    const state = { put: mockPut }
    const logger = { error: jest.fn() }
    await expect(recordPushes(state, 'test', '123', ['abc'], logger)).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('state unavailable'))
  })
})

describe('isStale', () => {
  beforeEach(() => { mockGet.mockClear() })

  test('false when state is null (fail open)', async () => {
    expect(await isStale(null, 'test', '123', 'abc', okProduct('2026-01-01T00:00:00Z'))).toBe(false)
  })

  test('false when the product has no lastUpdateDate', async () => {
    const state = { get: mockGet }
    expect(await isStale(state, 'test', '123', 'abc', {})).toBe(false)
    expect(mockGet).not.toHaveBeenCalled()
  })

  test('false when there is no stored push entry for this offerId', async () => {
    mockGet.mockResolvedValueOnce(undefined)
    const state = { get: mockGet }
    expect(await isStale(state, 'test', '123', 'abc', okProduct('2026-01-01T00:00:00Z'))).toBe(false)
  })

  test('true when lastUpdateDate predates the recorded push', async () => {
    const pushedAt = Date.now()
    mockGet.mockResolvedValueOnce({ value: String(pushedAt), expiration: '' })
    const state = { get: mockGet }
    const staleProduct = okProduct(new Date(pushedAt - 60000).toISOString()) // 1 min before the push
    expect(await isStale(state, 'test', '123', 'abc', staleProduct)).toBe(true)
  })

  test('false when lastUpdateDate is after the recorded push (already reprocessed)', async () => {
    const pushedAt = Date.now()
    mockGet.mockResolvedValueOnce({ value: String(pushedAt), expiration: '' })
    const state = { get: mockGet }
    const freshProduct = okProduct(new Date(pushedAt + 60000).toISOString()) // 1 min after the push
    expect(await isStale(state, 'test', '123', 'abc', freshProduct)).toBe(false)
  })

  test('false when the stored value is not a parseable number', async () => {
    mockGet.mockResolvedValueOnce({ value: 'not-a-number', expiration: '' })
    const state = { get: mockGet }
    expect(await isStale(state, 'test', '123', 'abc', okProduct('2026-01-01T00:00:00Z'))).toBe(false)
  })

  test('fails open (false) when state.get rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('state unavailable'))
    const state = { get: mockGet }
    expect(await isStale(state, 'test', '123', 'abc', okProduct('2026-01-01T00:00:00Z'))).toBe(false)
  })
})
