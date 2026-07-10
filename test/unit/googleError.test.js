const { parseGoogleError } = require('../../actions/lib/googleError')

describe('parseGoogleError - REST', () => {
  test('4xx is not retriable', () => {
    const err = { message: 'nope', response: { status: 400, data: { error: { status: 'INVALID_ARGUMENT', message: 'bad', details: [{ reason: 'invalid_attribute' }] } } } }
    const p = parseGoogleError(err)
    expect(p).toEqual(expect.objectContaining({ code: 400, status: 'INVALID_ARGUMENT', reason: 'invalid_attribute', retriable: false }))
  })
  test('429 is retriable', () => {
    const err = { message: 'rate', response: { status: 429, data: { error: {} } } }
    expect(parseGoogleError(err).retriable).toBe(true)
  })
  test('5xx is retriable', () => {
    const err = { message: 'boom', response: { status: 503, data: { error: {} } } }
    expect(parseGoogleError(err).retriable).toBe(true)
  })
  test('reason via metadata.REASON', () => {
    const err = { message: 'x', response: { status: 403, data: { error: { details: [{ metadata: { REASON: 'AUTH_GCP_NOT_REGISTERED' } }] } } } }
    expect(parseGoogleError(err).reason).toBe('AUTH_GCP_NOT_REGISTERED')
  })
})

describe('parseGoogleError - gax/gRPC', () => {
  test('UNAVAILABLE (14) is retriable', () => {
    const err = { code: 14, message: 'unavailable' }
    const p = parseGoogleError(err)
    expect(p.status).toBe('UNAVAILABLE')
    expect(p.retriable).toBe(true)
  })
  test('RESOURCE_EXHAUSTED (8) is retriable', () => {
    expect(parseGoogleError({ code: 8, message: 'quota' }).retriable).toBe(true)
  })
  test('INVALID_ARGUMENT (3) is NOT retriable', () => {
    const p = parseGoogleError({ code: 3, message: 'bad' })
    expect(p.status).toBe('INVALID_ARGUMENT')
    expect(p.retriable).toBe(false)
  })
  test('reason via statusDetails', () => {
    const err = { code: 7, message: 'x', statusDetails: [{ reason: 'AUTH_GCP_NOT_REGISTERED' }] }
    expect(parseGoogleError(err).reason).toBe('AUTH_GCP_NOT_REGISTERED')
  })
  test('unknown code maps to CODE_ label', () => {
    expect(parseGoogleError({ code: 999, message: '?' }).status).toBe('CODE_999')
  })
  test('never branches on message text', () => {
    // Sanity — messages don't affect retriable.
    const a = parseGoogleError({ code: 14, message: 'transient' })
    const b = parseGoogleError({ code: 14, message: 'anything else' })
    expect(a.retriable).toBe(b.retriable)
  })
})
