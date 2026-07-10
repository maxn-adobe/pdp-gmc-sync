const { mapProduct, toMicros, sanitizeOfferId } = require('../../actions/lib/mapProduct')
const defaults = require('../../config/defaults.json')

describe('toMicros', () => {
  test('numeric input', () => {
    expect(toMicros(12.99)).toEqual({ amountMicros: '12990000', currencyCode: 'USD' })
  })
  test('string input with dollar sign', () => {
    expect(toMicros('$25.00')).toEqual({ amountMicros: '25000000', currencyCode: 'USD' })
  })
  test('string plain', () => {
    expect(toMicros('7.5')).toEqual({ amountMicros: '7500000', currencyCode: 'USD' })
  })
  test('rounds half to nearest', () => {
    expect(toMicros(0.0000015)).toEqual({ amountMicros: '2', currencyCode: 'USD' })
  })
  test('zero is allowed', () => {
    expect(toMicros(0)).toEqual({ amountMicros: '0', currencyCode: 'USD' })
  })
  test('honors currencyCode arg', () => {
    expect(toMicros('9.99', 'EUR')).toEqual({ amountMicros: '9990000', currencyCode: 'EUR' })
  })
  test('negatives throw', () => {
    expect(() => toMicros(-1)).toThrow(/Invalid price/)
    expect(() => toMicros('-3.00')).toThrow(/Invalid price/)
  })
  test('non-numeric throws', () => {
    expect(() => toMicros('abc')).toThrow(/Invalid price/)
    expect(() => toMicros(null)).toThrow(/Invalid price/)
    expect(() => toMicros(undefined)).toThrow(/Invalid price/)
  })
})

describe('sanitizeOfferId', () => {
  test('trims whitespace', () => {
    expect(sanitizeOfferId('  abc  ')).toBe('abc')
  })
  test('coerces number', () => {
    expect(sanitizeOfferId(12345)).toBe('12345')
  })
  test('empties for null/undefined', () => {
    expect(sanitizeOfferId(null)).toBe('')
    expect(sanitizeOfferId(undefined)).toBe('')
  })
  test('replaces colons with hyphens (URN normalization)', () => {
    expect(sanitizeOfferId('urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37'))
      .toBe('urn-aaid-sc-VA6C2-2d65b3da-35d9-50f4-999e-f7d252530e37')
  })
  test('is idempotent — running twice yields the same result', () => {
    const once = sanitizeOfferId('urn:aaid:sc:VA6C2:abc')
    expect(sanitizeOfferId(once)).toBe(once)
  })
})

describe('mapProduct', () => {
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice mug',
    description: 'ceramic 11oz',
    link: 'https://www.adobe.com/express/print/mug/a-nice-mug',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/mug.png',
    price: '12.99',
    product_type: 'zazzle_mug'
  }

  test('produces the top-level v1 shape', () => {
    const out = mapProduct(goodRow)
    expect(out).toEqual(expect.objectContaining({
      offerId: 'urn-aaid-sc-VA6C2-2d65b3da-35d9-50f4-999e-f7d252530e37',
      contentLanguage: 'en',
      feedLabel: 'US'
    }))
    expect(out.productAttributes).toEqual(expect.objectContaining({
      title: 'A nice mug',
      description: 'ceramic 11oz',
      imageLink: 'https://cdn.example.com/mug.png',
      availability: 'IN_STOCK',
      condition: 'NEW',
      brand: defaults.brand,
      price: { amountMicros: '12990000', currencyCode: 'USD' }
    }))
  })

  test('title truncates to 150 chars', () => {
    const long = 'x'.repeat(200)
    const out = mapProduct({ ...goodRow, title: long })
    expect(out.productAttributes.title.length).toBe(150)
  })

  test('link is passed through unchanged (allowlisted host)', () => {
    const out = mapProduct(goodRow)
    expect(out.productAttributes.link).toBe(goodRow.link)
  })

  test('link on aem.live preview host also passes through', () => {
    const link = 'https://main--da-express-milo--adobecom.aem.live/express/print/mug/a-nice-mug'
    const out = mapProduct({ ...goodRow, link })
    expect(out.productAttributes.link).toBe(link)
  })

  test('identifierExists=false when no gtin/gtins', () => {
    const out = mapProduct(goodRow)
    expect(out.productAttributes.identifierExists).toBe(false)
    expect(out.productAttributes.gtins).toBeUndefined()
  })

  test('gtins pass through and identifierExists is not set', () => {
    const out = mapProduct({ ...goodRow, gtin: '00012345' })
    expect(out.productAttributes.gtins).toEqual(['00012345'])
    expect(out.productAttributes.identifierExists).toBeUndefined()
  })

  test('per-row overrides beat defaults', () => {
    const out = mapProduct({ ...goodRow, availability: 'OUT_OF_STOCK', brand: 'Zazzle', condition: 'REFURBISHED' })
    expect(out.productAttributes.availability).toBe('OUT_OF_STOCK')
    expect(out.productAttributes.brand).toBe('Zazzle')
    expect(out.productAttributes.condition).toBe('REFURBISHED')
  })

  test('unmapped product_type omits googleProductCategory', () => {
    const out = mapProduct({ ...goodRow, product_type: 'no-such-type' })
    expect(out.productAttributes.googleProductCategory).toBeUndefined()
  })

  test('empty product_id throws', () => {
    expect(() => mapProduct({ ...goodRow, product_id: '' })).toThrow(/product_id/)
  })

  test('missing link throws', () => {
    const { link, ...noLink } = goodRow
    expect(() => mapProduct(noLink)).toThrow(/link/)
  })

  test('falls back to base_price when price missing', () => {
    const { price, ...noPrice } = goodRow
    const out = mapProduct({ ...noPrice, base_price: 8.5 })
    expect(out.productAttributes.price).toEqual({ amountMicros: '8500000', currencyCode: 'USD' })
  })
})
