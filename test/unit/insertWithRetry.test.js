const { insertWithRetry } = require('../../actions/lib/insertWithRetry')

const silentLogger = { error: () => {}, info: () => {}, debug: () => {} }

function mockClient (impls) {
  const calls = []
  const client = {
    insertProductInput: jest.fn(async (req) => {
      calls.push(req)
      const impl = impls[calls.length - 1]
      if (typeof impl === 'function') return impl()
      return impl
    })
  }
  client.calls = calls
  return client
}

describe('insertWithRetry', () => {
  test('returns ok on first-try success', async () => {
    const client = mockClient([[{ name: 'accounts/1/productInputs/en~US~a' }]])
    const res = await insertWithRetry(client, {}, 'a', silentLogger)
    expect(res).toEqual({ offerId: 'a', ok: true, name: 'accounts/1/productInputs/en~US~a' })
    expect(client.insertProductInput).toHaveBeenCalledTimes(1)
  })

  test('does NOT retry on 4xx', async () => {
    const err = { response: { status: 400, data: { error: { status: 'INVALID_ARGUMENT' } } }, message: 'bad' }
    const client = mockClient([() => { throw err }])
    const res = await insertWithRetry(client, {}, 'a', silentLogger)
    expect(res.ok).toBe(false)
    expect(res.status).toBe('INVALID_ARGUMENT')
    expect(res.code).toBe(400)
    expect(client.insertProductInput).toHaveBeenCalledTimes(1)
  })

  test('retries once on 5xx and succeeds', async () => {
    const err = { response: { status: 503, data: { error: {} } }, message: 'x' }
    const client = mockClient([
      () => { throw err },
      [{ name: 'accounts/1/productInputs/en~US~a' }]
    ])
    const res = await insertWithRetry(client, {}, 'a', silentLogger)
    expect(res.ok).toBe(true)
    expect(res.retried).toBe(true)
    expect(client.insertProductInput).toHaveBeenCalledTimes(2)
  })

  test('retries once on 5xx and fails, no third try', async () => {
    const err = { response: { status: 503, data: { error: {} } }, message: 'x' }
    const client = mockClient([() => { throw err }, () => { throw err }])
    const res = await insertWithRetry(client, {}, 'a', silentLogger)
    expect(res.ok).toBe(false)
    expect(res.retried).toBe(true)
    expect(res.code).toBe(503)
    expect(client.insertProductInput).toHaveBeenCalledTimes(2)
  })

  test('retries once on 429 and succeeds', async () => {
    const err = { response: { status: 429, data: { error: {} } }, message: 'rate' }
    const client = mockClient([() => { throw err }, [{ name: 'n' }]])
    const res = await insertWithRetry(client, {}, 'z', silentLogger)
    expect(res.ok).toBe(true)
    expect(res.retried).toBe(true)
  })
})
