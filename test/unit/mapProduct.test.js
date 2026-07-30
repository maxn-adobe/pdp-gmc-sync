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
  test('strips the constant urn:aaid:sc:<catalog>: namespace prefix, keeping the per-product suffix', () => {
    // The full sanitized id ("urn-aaid-sc-VA6C2-...") is 54 chars — over
    // Google's real 50-char `id` limit (confirmed via a live insert
    // rejection: "Value too long in attribute: id"). The namespace prefix is
    // constant across every product observed, so it's dropped, keeping just
    // the 36-char UUID suffix as offerId.
    expect(sanitizeOfferId('urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37'))
      .toBe('2d65b3da-35d9-50f4-999e-f7d252530e37')
  })
  test('still replaces colons with hyphens for ids not in the urn:aaid:sc: shape', () => {
    expect(sanitizeOfferId('foo:bar:baz')).toBe('foo-bar-baz')
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
      offerId: '2d65b3da-35d9-50f4-999e-f7d252530e37',
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

describe('mapProduct — product_type / department_name', () => {
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice mug',
    description: 'ceramic 11oz',
    link: 'https://www.adobe.com/express/print/mug/a-nice-mug',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/mug.png',
    price: '12.99'
  }

  test('sets productTypes from department_name when present', () => {
    const out = mapProduct({ ...goodRow, department_name: "Men's T-Shirts" })
    expect(out.productAttributes.productTypes).toEqual(["Print > Men's T-Shirts"])
  })

  test('omits productTypes entirely when department_name is absent', () => {
    const out = mapProduct(goodRow)
    expect(out.productAttributes.productTypes).toBeUndefined()
  })
})

describe('mapProduct — sale_price / sale_price_end_date', () => {
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice mug',
    description: 'ceramic 11oz',
    link: 'https://www.adobe.com/express/print/mug/a-nice-mug',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/mug.png',
    price: '12.99'
  }

  test('sets salePrice and a proper google.type.Interval salePriceEffectiveDate when sale_price_end_date is in the future', () => {
    const endDate = new Date(Date.now() + 1000 * 60 * 60 * 24)
    const before = Math.floor(Date.now() / 1000)
    const out = mapProduct({ ...goodRow, sale_price: 8.99, sale_price_end_date: endDate.toISOString() })
    const after = Math.floor(Date.now() / 1000)

    expect(out.productAttributes.salePrice).toEqual({ amountMicros: '8990000', currencyCode: 'USD' })

    // salePriceEffectiveDate must be a google.type.Interval ({ startTime,
    // endTime } with Timestamp-shaped { seconds } sub-objects) — NOT the
    // "start/end" string the field name might suggest. A plain string
    // throws `object expected` when encoded via the real
    // @google-shopping/products v1 proto (ProductAttributes.fromObject()).
    const effectiveDate = out.productAttributes.salePriceEffectiveDate
    expect(effectiveDate.startTime.seconds).toBeGreaterThanOrEqual(before)
    expect(effectiveDate.startTime.seconds).toBeLessThanOrEqual(after)
    expect(effectiveDate.endTime).toEqual({ seconds: Math.floor(endDate.getTime() / 1000) })

    // Confirm it actually round-trips through the real proto without throwing.
    const protos = require('@google-shopping/products/build/protos/protos.js')
    const { ProductAttributes } = protos.google.shopping.merchant.products.v1
    expect(() => ProductAttributes.fromObject(out.productAttributes)).not.toThrow()
  })

  test('omits both fields when sale_price_end_date is already in the past', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
    const out = mapProduct({ ...goodRow, sale_price: 8.99, sale_price_end_date: past })
    expect(out.productAttributes.salePrice).toBeUndefined()
    expect(out.productAttributes.salePriceEffectiveDate).toBeUndefined()
  })

  test('omits both fields when sale_price_end_date is absent', () => {
    const out = mapProduct({ ...goodRow, sale_price: 8.99 })
    expect(out.productAttributes.salePrice).toBeUndefined()
    expect(out.productAttributes.salePriceEffectiveDate).toBeUndefined()
  })

  test('omits both fields when sale_price is absent, even with a future end date', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()
    const out = mapProduct({ ...goodRow, sale_price_end_date: future })
    expect(out.productAttributes.salePrice).toBeUndefined()
    expect(out.productAttributes.salePriceEffectiveDate).toBeUndefined()
  })
})

describe('mapProduct — variant attribute pass-through', () => {
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice T-shirt',
    description: 'soft cotton tee',
    link: 'https://www.adobe.com/express/print/t-shirt/a-nice-tee',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/tee.png',
    price: '19.99'
  }

  test('passes through material, color, size when present', () => {
    const out = mapProduct({
      ...goodRow,
      material: 'Bella+Canvas Tri-Blend',
      color: 'White',
      size: 'Adult S'
    })
    expect(out.productAttributes.material).toBe('Bella+Canvas Tri-Blend')
    expect(out.productAttributes.color).toBe('White')
    expect(out.productAttributes.size).toBe('Adult S')
  })

  test('upper-cases age_group and gender to match GMC enum values', () => {
    const out = mapProduct({ ...goodRow, age_group: 'adult', gender: 'unisex' })
    expect(out.productAttributes.ageGroup).toBe('ADULT')
    expect(out.productAttributes.gender).toBe('UNISEX')
  })

  test('omits material/color/size/age_group/gender when absent', () => {
    const out = mapProduct(goodRow)
    expect(out.productAttributes.material).toBeUndefined()
    expect(out.productAttributes.color).toBeUndefined()
    expect(out.productAttributes.size).toBeUndefined()
    expect(out.productAttributes.ageGroup).toBeUndefined()
    expect(out.productAttributes.gender).toBeUndefined()
  })
})

describe('mapProduct — customAttributes (printing_type / capacity / minimum_order_quantity)', () => {
  // printing_type, capacity, and minimum_order_quantity have no matching
  // top-level field anywhere in the installed @google-shopping/products v1
  // proto (checked v0.9.0, both v1 and v1beta) — they must not be set as
  // productAttributes.printingType / .capacity / .minimumOrderQuantity
  // (those are silently dropped by protobufjs, never reaching GMC).
  // Instead they go into the generic `customAttributes` escape valve on
  // ProductInput (a sibling of productAttributes, not nested inside it):
  // repeated { name, value } string pairs.
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice T-shirt',
    description: 'soft cotton tee',
    link: 'https://www.adobe.com/express/print/t-shirt/a-nice-tee',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/tee.png',
    price: '19.99'
  }

  test('does not set printingType/capacity/minimumOrderQuantity on productAttributes', () => {
    const out = mapProduct({ ...goodRow, printing_type: 'Classic Printing: No Underbase', capacity: '12 oz', minimum_order_quantity: 5 })
    expect(out.productAttributes.printingType).toBeUndefined()
    expect(out.productAttributes.capacity).toBeUndefined()
    expect(out.productAttributes.minimumOrderQuantity).toBeUndefined()
  })

  test('pushes printing_type and capacity into customAttributes when present', () => {
    const out = mapProduct({ ...goodRow, printing_type: 'Classic Printing: No Underbase', capacity: '12 oz' })
    expect(out.customAttributes).toContainEqual({ name: 'printing_type', value: 'Classic Printing: No Underbase' })
    expect(out.customAttributes).toContainEqual({ name: 'capacity', value: '12 oz' })
  })

  test('omits printing_type/capacity customAttributes entries when the row does not supply them', () => {
    const out = mapProduct(goodRow)
    expect(out.customAttributes.find(a => a.name === 'printing_type')).toBeUndefined()
    expect(out.customAttributes.find(a => a.name === 'capacity')).toBeUndefined()
  })

  test('minimum_order_quantity is always present in customAttributes, defaulting to "1"', () => {
    const out = mapProduct(goodRow)
    expect(out.customAttributes).toContainEqual({ name: 'minimum_order_quantity', value: '1' })
  })

  test('minimum_order_quantity passes through the row value (stringified) in customAttributes', () => {
    const out = mapProduct({ ...goodRow, minimum_order_quantity: 5 })
    expect(out.customAttributes).toContainEqual({ name: 'minimum_order_quantity', value: '5' })
  })

  test('round-trips through the real ProductInput proto without throwing', () => {
    const protos = require('@google-shopping/products/build/protos/protos.js')
    const { ProductInput } = protos.google.shopping.merchant.products.v1
    const out = mapProduct({ ...goodRow, printing_type: 'Classic Printing', capacity: '12 oz' })
    expect(() => ProductInput.fromObject(out)).not.toThrow()
  })
})

describe('mapProduct — custom_label_0 / shipping_label', () => {
  const goodRow = {
    product_id: 'urn:aaid:sc:VA6C2:2d65b3da-35d9-50f4-999e-f7d252530e37',
    title: 'A nice mug',
    description: 'ceramic 11oz',
    link: 'https://www.adobe.com/express/print/mug/a-nice-mug',
    initial_pretty_preferred_view_url: 'https://cdn.example.com/mug.png',
    price: '12.99'
  }

  test('passes through custom_label_0 and shipping_label when present', () => {
    const out = mapProduct({ ...goodRow, custom_label_0: 'US-Mugs', shipping_label: 'standard' })
    expect(out.productAttributes.customLabel_0).toBe('US-Mugs')
    expect(out.productAttributes.shippingLabel).toBe('standard')
  })

  test('omits custom_label_0 and shipping_label when absent', () => {
    const out = mapProduct(goodRow)
    expect(out.productAttributes.customLabel_0).toBeUndefined()
    expect(out.productAttributes.shippingLabel).toBeUndefined()
  })
})
