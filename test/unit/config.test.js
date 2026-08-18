const { resolveAccount, resolveDataSource } = require('../../actions/lib/config')

describe('resolveAccount', () => {
  test('returns bare account id', () => {
    expect(resolveAccount({ GMC_ENV: 'test', GMC_MERCHANT_ACCOUNT_ID: '12345' })).toBe('12345')
  })
  test('strips accounts/ prefix if present', () => {
    expect(resolveAccount({ GMC_ENV: 'test', GMC_MERCHANT_ACCOUNT_ID: 'accounts/12345' })).toBe('12345')
  })
  test('rejects unknown GMC_ENV', () => {
    expect(() => resolveAccount({ GMC_ENV: 'staging' })).toThrow(/GMC_ENV must be/)
  })
  test('rejects missing GMC_ENV', () => {
    expect(() => resolveAccount({})).toThrow(/GMC_ENV must be/)
  })
  test('placeholder value counts as missing', () => {
    expect(() => resolveAccount({ GMC_ENV: 'test', GMC_MERCHANT_ACCOUNT_ID: '__PLACEHOLDER__' })).toThrow(/Missing/)
  })
  test('empty string counts as missing', () => {
    expect(() => resolveAccount({ GMC_ENV: 'test', GMC_MERCHANT_ACCOUNT_ID: '' })).toThrow(/Missing/)
  })
})

describe('resolveDataSource', () => {
  test('builds fully qualified name from bare id', () => {
    expect(resolveDataSource({ GMC_DATASOURCE_ID: '9876' }, '12345'))
      .toBe('accounts/12345/dataSources/9876')
  })
  test('accepts already-qualified id and normalizes', () => {
    expect(resolveDataSource({ GMC_DATASOURCE_ID: 'accounts/9/dataSources/9876' }, '12345'))
      .toBe('accounts/12345/dataSources/9876')
  })
  test('missing placeholder throws with actionable message', () => {
    expect(() => resolveDataSource({ GMC_DATASOURCE_ID: '__PLACEHOLDER__' }, '12345'))
      .toThrow(/bootstrap-datasource/)
  })
})
