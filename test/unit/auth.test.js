const { getAuthClient } = require('../../actions/lib/auth')

describe('getAuthClient', () => {
  test('throws when no credentials are provided', () => {
    expect(() => getAuthClient({})).toThrow(/credentials not configured/)
  })
  test('throws when all creds are placeholder values', () => {
    expect(() => getAuthClient({
      GMC_CLIENT_ID: '__PLACEHOLDER__',
      GMC_CLIENT_SECRET: '__PLACEHOLDER__',
      GMC_REFRESH_TOKEN: '__PLACEHOLDER__'
    })).toThrow(/credentials not configured/)
  })
  test('throws when only partial OAuth creds present', () => {
    expect(() => getAuthClient({
      GMC_CLIENT_ID: 'real',
      GMC_CLIENT_SECRET: '',
      GMC_REFRESH_TOKEN: 'real'
    })).toThrow(/credentials not configured/)
  })
  test('builds an OAuth2Client when all three OAuth params are non-placeholder', () => {
    const client = getAuthClient({
      GMC_CLIENT_ID: 'cid',
      GMC_CLIENT_SECRET: 'csec',
      GMC_REFRESH_TOKEN: 'rtok'
    })
    expect(client).toBeTruthy()
    expect(typeof client.getAccessToken).toBe('function')
  })
  test('throws helpful error on malformed service account JSON', () => {
    expect(() => getAuthClient({ GMC_SERVICE_ACCOUNT_JSON: '{not json' })).toThrow(/not valid JSON/)
  })
})
