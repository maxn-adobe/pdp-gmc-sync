const { resolveAccount, resolveDataSource } = require('../../actions/lib/config')

describe('resolveAccount', () => {
  test('returns bare account id from test env', () => {
    expect(resolveAccount({ GMC_MERCHANT_ACCOUNT_ID_TEST: '12345' }, 'test')).toBe('12345')
  })
  test('strips accounts/ prefix if present', () => {
    expect(resolveAccount({ GMC_MERCHANT_ACCOUNT_ID_TEST: 'accounts/12345' }, 'test')).toBe('12345')
  })
  test('rejects unknown env', () => {
    expect(() => resolveAccount({}, 'staging')).toThrow(/env must be/)
  })
  test('placeholder value counts as missing', () => {
    expect(() => resolveAccount({ GMC_MERCHANT_ACCOUNT_ID_TEST: '__PLACEHOLDER__' }, 'test')).toThrow(/Missing/)
  })
  test('empty string counts as missing', () => {
    expect(() => resolveAccount({ GMC_MERCHANT_ACCOUNT_ID_TEST: '' }, 'test')).toThrow(/Missing/)
  })
})

describe('resolveDataSource', () => {
  test('builds fully qualified name from bare id', () => {
    expect(resolveDataSource({ GMC_DATASOURCE_ID_TEST: '9876' }, 'test', '12345'))
      .toBe('accounts/12345/dataSources/9876')
  })
  test('accepts already-qualified id and normalizes', () => {
    expect(resolveDataSource({ GMC_DATASOURCE_ID_TEST: 'accounts/9/dataSources/9876' }, 'test', '12345'))
      .toBe('accounts/12345/dataSources/9876')
  })
  test('missing placeholder throws with actionable message', () => {
    expect(() => resolveDataSource({ GMC_DATASOURCE_ID_TEST: '__PLACEHOLDER__' }, 'test', '12345'))
      .toThrow(/bootstrap-datasource/)
  })
})
