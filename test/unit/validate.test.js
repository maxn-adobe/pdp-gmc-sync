const { validateRow, validateRows, MAX_CHUNK } = require('../../actions/lib/validate')

const good = {
  product_id: 'zaz-1',
  title: 'A thing',
  url_slug: 'print/thing/zaz-1',
  initial_pretty_preferred_view_url: 'https://cdn.example.com/x.png',
  price: '9.99'
}

describe('validateRow', () => {
  test('accepts a well-formed row', () => {
    expect(validateRow(good)).toBeNull()
  })
  test('rejects missing product_id', () => {
    expect(validateRow({ ...good, product_id: '' })).toMatch(/product_id/)
  })
  test('rejects missing title', () => {
    expect(validateRow({ ...good, title: '' })).toMatch(/title/)
  })
  test('rejects non-http image', () => {
    expect(validateRow({ ...good, initial_pretty_preferred_view_url: 'javascript:alert(1)' })).toMatch(/http/i)
  })
  test('accepts image_link fallback', () => {
    const { initial_pretty_preferred_view_url: _, ...rest } = good
    expect(validateRow({ ...rest, image_link: 'https://cdn.example.com/x.png' })).toBeNull()
  })
  test('rejects negative price', () => {
    expect(validateRow({ ...good, price: -1 })).toMatch(/price/i)
  })
  test('rejects non-string description', () => {
    expect(validateRow({ ...good, description: 42 })).toMatch(/description/)
  })
  test('rejects non-object rows', () => {
    expect(validateRow(null)).toMatch(/object/)
    expect(validateRow('str')).toMatch(/object/)
  })
})

describe('validateRows', () => {
  test('partitions valid vs invalid', () => {
    const rows = [good, { ...good, product_id: '' }, { ...good, product_id: 'z2' }]
    const { valid, invalid } = validateRows(rows)
    expect(valid.length).toBe(2)
    expect(invalid.length).toBe(1)
    expect(invalid[0].reason).toMatch(/product_id/)
  })
})

describe('MAX_CHUNK', () => {
  test('is exposed and reasonable', () => {
    expect(MAX_CHUNK).toBeGreaterThanOrEqual(250)
    expect(MAX_CHUNK).toBeLessThanOrEqual(500)
  })
})
