jest.mock('../../actions/lib/syncState', () => ({
  isStale: jest.fn(),
  getPushedAt: jest.fn()
}))

const { isStale, getPushedAt } = require('../../actions/lib/syncState')
const {
  fetchProductStatus,
  fetchAllStatuses,
  searchProductDiagnostics,
  summarizeProductDiagnostics,
  classify,
  collectIssues,
  summarize
} = require('../../actions/lib/diagnostics')

const approvedProduct = {
  name: 'accounts/123/products/en~US~abc',
  productStatus: {
    destinationStatuses: [{ approvedCountries: ['US'] }],
    itemLevelIssues: []
  }
}

const disapprovedProduct = {
  name: 'accounts/123/products/en~US~abc',
  productStatus: {
    destinationStatuses: [{ disapprovedCountries: ['US'] }],
    itemLevelIssues: [{ code: 'image_link', severity: 'ERROR', attribute: 'image_link' }]
  }
}

describe('classify', () => {
  test('active when any destination has an approved country', () => {
    expect(classify(approvedProduct)).toBe('active')
  })
  test('disapproved when no destination is approved or pending', () => {
    expect(classify(disapprovedProduct)).toBe('disapproved')
  })
  test('pending when some destination has a pending country and none is approved', () => {
    expect(classify({ productStatus: { destinationStatuses: [{ pendingCountries: ['US'] }] } })).toBe('pending')
  })
  test('unknown when there is no productStatus at all', () => {
    expect(classify({})).toBe('unknown')
  })
})

describe('collectIssues', () => {
  test('maps itemLevelIssues to a flat shape', () => {
    expect(collectIssues(disapprovedProduct)).toEqual([
      { code: 'image_link', severity: 'ERROR', resolution: '', attribute: 'image_link', description: '', documentation: '' }
    ])
  })
  test('empty array when there are no issues', () => {
    expect(collectIssues(approvedProduct)).toEqual([])
  })
})

describe('fetchProductStatus', () => {
  beforeEach(() => { isStale.mockReset() })

  test('adds stale:true when isStale resolves true', async () => {
    isStale.mockResolvedValue(true)
    const productsClient = { getProduct: jest.fn(async () => [approvedProduct]) }
    const result = await fetchProductStatus(productsClient, '123', 'abc', { fake: 'state' }, 'test')
    expect(result).toEqual(expect.objectContaining({ offerId: 'abc', ok: true, status: 'active', stale: true }))
  })

  test('omits the stale key entirely when isStale resolves false', async () => {
    isStale.mockResolvedValue(false)
    const productsClient = { getProduct: jest.fn(async () => [approvedProduct]) }
    const result = await fetchProductStatus(productsClient, '123', 'abc', null, 'test')
    expect(result.stale).toBeUndefined()
  })

  test('a getProduct failure never calls isStale and returns an error result', async () => {
    const productsClient = { getProduct: jest.fn(async () => { throw new Error('not found') }) }
    const result = await fetchProductStatus(productsClient, '123', 'abc', { fake: 'state' }, 'test')
    expect(result.ok).toBe(false)
    expect(result.status).toBe('error')
    expect(isStale).not.toHaveBeenCalled()
  })

  test('passes state/env through to isStale unchanged', async () => {
    isStale.mockResolvedValue(false)
    const state = { fake: 'state' }
    const productsClient = { getProduct: jest.fn(async () => [approvedProduct]) }
    await fetchProductStatus(productsClient, '123', 'abc', state, 'test')
    expect(isStale).toHaveBeenCalledWith(state, 'test', '123', 'abc', approvedProduct, undefined)
  })

  describe('NOT_FOUND handling', () => {
    beforeEach(() => { getPushedAt.mockReset() })
    const notFoundError = () => Object.assign(new Error('5 NOT_FOUND: no product found'), { code: 5 })

    test('NOT_FOUND with a recent recorded push is reported as pending, not an error', async () => {
      getPushedAt.mockResolvedValue(Date.now() - 5 * 60 * 1000)
      const state = { fake: 'state' }
      const productsClient = { getProduct: jest.fn(async () => { throw notFoundError() }) }
      const result = await fetchProductStatus(productsClient, '123', 'abc', state, 'test')
      expect(result).toEqual({ offerId: 'abc', ok: true, status: 'pending', stale: true })
      expect(getPushedAt).toHaveBeenCalledWith(state, 'test', '123', 'abc', undefined)
    })

    test('NOT_FOUND with no recorded push at all is a genuine error', async () => {
      getPushedAt.mockResolvedValue(null)
      const productsClient = { getProduct: jest.fn(async () => { throw notFoundError() }) }
      const result = await fetchProductStatus(productsClient, '123', 'abc', { fake: 'state' }, 'test')
      expect(result.ok).toBe(false)
      expect(result.status).toBe('error')
      expect(result.statusCode).toBe('NOT_FOUND')
    })

    test('NOT_FOUND with an old/expired recorded push is a genuine error', async () => {
      getPushedAt.mockResolvedValue(Date.now() - 2 * 60 * 60 * 1000)
      const productsClient = { getProduct: jest.fn(async () => { throw notFoundError() }) }
      const result = await fetchProductStatus(productsClient, '123', 'abc', { fake: 'state' }, 'test')
      expect(result.ok).toBe(false)
      expect(result.status).toBe('error')
      expect(result.statusCode).toBe('NOT_FOUND')
    })
  })
})

describe('fetchAllStatuses', () => {
  test('runs fetchProductStatus for every offerId and threads state/env through', async () => {
    isStale.mockResolvedValue(false)
    const productsClient = { getProduct: jest.fn(async () => [approvedProduct]) }
    const results = await fetchAllStatuses(productsClient, '123', ['a', 'b', 'c'], { fake: 'state' }, 'test')
    expect(results).toHaveLength(3)
    expect(results.every(r => r.status === 'active')).toBe(true)
  })
})

describe('searchProductDiagnostics', () => {
  test('scopes products by data source and requests detailed product_view diagnostics', async () => {
    const dataSource = 'accounts/123/dataSources/456'
    const productsClient = {
      listProducts: jest.fn(async () => [[
        {
          name: 'accounts/123/products/en~US~owned',
          offerId: 'owned',
          dataSource
        },
        {
          name: 'accounts/123/products/en~US~other',
          offerId: 'other',
          dataSource: 'accounts/123/dataSources/999'
        },
        {
          name: 'accounts/123/products/en~US~not-requested',
          offerId: 'not-requested',
          dataSource
        }
      ]])
    }
    const reportsClient = {
      search: jest.fn(async () => [[{
        productView: {
          id: 'en~US~owned',
          offerId: 'owned',
          aggregatedReportingContextStatus: 'ELIGIBLE_LIMITED',
          statusPerReportingContext: [{ reportingContext: 'FREE_LISTINGS', approvedCountries: ['US'] }],
          itemIssues: [{ type: { code: 'missing_attribute', canonicalAttribute: 'n:gender' } }]
        }
      }]])
    }

    const products = await searchProductDiagnostics(reportsClient, productsClient, '123', dataSource, ['owned'])

    expect(productsClient.listProducts).toHaveBeenCalledWith({ parent: 'accounts/123', pageSize: 1000 })
    expect(reportsClient.search).toHaveBeenCalledTimes(1)
    const request = reportsClient.search.mock.calls[0][0]
    expect(request.parent).toBe('accounts/123')
    expect(request.pageSize).toBe(1000)
    expect(request.query).toContain('FROM product_view')
    expect(request.query).toContain("WHERE id IN ('en~US~owned')")
    expect(request.query).not.toContain('en~US~other')
    expect(request.query).not.toContain('en~US~not-requested')
    expect(request.query).toContain('aggregated_reporting_context_status')
    expect(request.query).toContain('status_per_reporting_context')
    expect(request.query).toContain('item_issues')
    expect(products).toEqual([expect.objectContaining({
      offerId: 'owned',
      aggregatedReportingContextStatus: 'ELIGIBLE_LIMITED'
    })])
  })

  test('does not issue an empty MCQL request when the data source has no processed products', async () => {
    const productsClient = { listProducts: jest.fn(async () => [[]]) }
    const reportsClient = { search: jest.fn() }
    await expect(searchProductDiagnostics(
      reportsClient,
      productsClient,
      '123',
      'accounts/123/dataSources/456'
    )).resolves.toEqual([])
    expect(reportsClient.search).not.toHaveBeenCalled()
  })
})

describe('summarizeProductDiagnostics', () => {
  test('counts report eligibility states and tallies detailed item issues', () => {
    const productViews = [
      { aggregatedReportingContextStatus: 'ELIGIBLE', itemIssues: [] },
      {
        aggregatedReportingContextStatus: 'ELIGIBLE_LIMITED',
        itemIssues: [{
          type: { code: 'missing_attribute', canonicalAttribute: 'n:gender' },
          severity: { aggregatedSeverity: 'DISAPPROVED' },
          resolution: 'MERCHANT_ACTION'
        }]
      },
      {
        aggregatedReportingContextStatus: 1,
        itemIssues: [{
          type: { code: 'missing_attribute', canonicalAttribute: 'n:gender' },
          severity: { aggregatedSeverity: 1 },
          resolution: 1
        }]
      },
      { aggregatedReportingContextStatus: 'PENDING', itemIssues: [] },
      { aggregatedReportingContextStatus: 'AGGREGATED_REPORTING_CONTEXT_STATUS_UNSPECIFIED' }
    ]

    expect(summarizeProductDiagnostics(productViews)).toEqual({
      counts: { active: 1, limited: 1, pending: 1, disapproved: 1, unknown: 1, error: 0 },
      itemIssueTop: [{
        code: 'missing_attribute',
        severity: 'DISAPPROVED',
        resolution: 'MERCHANT_ACTION',
        attribute: 'n:gender',
        count: 2
      }]
    })
  })
})

describe('summarize', () => {
  test('counts statuses and tallies issues, ignoring stale', () => {
    const results = [
      { ok: true, status: 'active', issues: [] },
      { ok: true, status: 'disapproved', stale: true, issues: [{ code: 'x', severity: 'ERROR', attribute: 'image_link' }] },
      { ok: false }
    ]
    const { counts, itemIssueTop } = summarize(results)
    expect(counts).toEqual({ active: 1, pending: 0, disapproved: 1, unknown: 0, error: 1 })
    expect(itemIssueTop).toEqual([{ code: 'x', severity: 'ERROR', attribute: 'image_link', count: 1 }])
  })
})
