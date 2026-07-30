const { validateRow, validateRows, validateLink, MAX_CHUNK } = require('../../actions/lib/validate')

const good = {
  product_id: 'urn:aaid:sc:VA6C2:abc',
  title: 'A thing',
  description: 'A perfectly nice thing.',
  link: 'https://www.adobe.com/express/print/mug/a-thing',
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
  test('rejects missing description', () => {
    const { description, ...rest } = good
    expect(validateRow(rest)).toMatch(/description/)
  })
  test('rejects empty description', () => {
    expect(validateRow({ ...good, description: '' })).toMatch(/description/)
    expect(validateRow({ ...good, description: '   ' })).toMatch(/description/)
  })
  test('rejects description over the max length', () => {
    expect(validateRow({ ...good, description: 'x'.repeat(5001) })).toMatch(/description/)
  })
  test('rejects non-object rows', () => {
    expect(validateRow(null)).toMatch(/object/)
    expect(validateRow('str')).toMatch(/object/)
  })
})

describe('link allowlist', () => {
  test('accepts adobe.com production host', () => {
    expect(validateLink('https://www.adobe.com/express/print/mug/x')).toBeNull()
  })
  test('accepts aem.live preview host', () => {
    expect(validateLink('https://main--da-express-milo--adobecom.aem.live/express/print/mug/x')).toBeNull()
  })
  test('rejects http (non-HTTPS)', () => {
    expect(validateLink('http://www.adobe.com/express/print/mug/x')).toMatch(/https/i)
  })
  test('rejects a non-allowlisted host', () => {
    expect(validateLink('https://evil.example.com/express/print/mug/x')).toMatch(/allowlist/i)
  })
  test('rejects a malformed URL', () => {
    expect(validateLink('not-a-url')).toMatch(/valid URL|https/i)
  })
  test('rejects missing link', () => {
    expect(validateLink('')).toMatch(/missing/)
    expect(validateLink(undefined)).toMatch(/missing/)
  })
  test('catches the userinfo trick (https://good.com@evil.com resolves to evil.com)', () => {
    // new URL('https://www.adobe.com@evil.com/').hostname === 'evil.com'
    expect(validateLink('https://www.adobe.com@evil.com/foo')).toMatch(/allowlist/i)
  })
  test('validateRow rejects rows with a bad link', () => {
    expect(validateRow({ ...good, link: 'http://www.adobe.com/express/print/mug/x' })).toMatch(/https/i)
    expect(validateRow({ ...good, link: 'https://evil.com/express/print/mug/x' })).toMatch(/allowlist/i)
    const { link: _, ...noLink } = good
    expect(validateRow(noLink)).toMatch(/link/i)
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
  test('is lowered to 50 to respect the Adobe I/O Runtime 1MB payload limit', () => {
    expect(MAX_CHUNK).toBe(50)
  })
})
