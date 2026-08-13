const {
  searchProductDiagnostics,
  summarizeProductDiagnostics,
  classifyProductView
} = require('../../actions/lib/diagnostics')

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

    expect(productsClient.listProducts).toHaveBeenCalledWith(
      { parent: 'accounts/123', pageSize: 1000, pageToken: undefined },
      { autoPaginate: false }
    )
    expect(reportsClient.search).toHaveBeenCalledTimes(1)
    const request = reportsClient.search.mock.calls[0][0]
    expect(request.parent).toBe('accounts/123')
    expect(request.pageSize).toBe(1000)
    expect(request.pageToken).toBeUndefined()
    expect(request.query).toContain('FROM product_view')
    expect(request.query).toContain("WHERE id IN ('en~US~owned')")
    expect(request.query).not.toContain('en~US~other')
    expect(request.query).not.toContain('en~US~not-requested')
    expect(request.query).toContain('aggregated_reporting_context_status')
    expect(request.query).toContain('status_per_reporting_context')
    expect(request.query).toContain('item_issues')
    expect(reportsClient.search.mock.calls[0][1]).toEqual({ autoPaginate: false })
    expect(products).toEqual([expect.objectContaining({
      offerId: 'owned',
      aggregatedReportingContextStatus: 'ELIGIBLE_LIMITED',
      diagnosticSource: 'reports'
    })])
  })

  test('falls back to Product status when Reports has not indexed a processed pending product', async () => {
    const dataSource = 'accounts/123/dataSources/456'
    const pendingStatus = {
      destinationStatuses: [{
        reportingContext: 'SHOPPING_ADS',
        pendingCountries: ['US']
      }],
      itemLevelIssues: [{
        code: 'pending_image_crawl',
        severity: 'NOT_IMPACTED',
        resolution: 'pending_processing',
        attribute: 'image_link',
        reportingContext: 'SHOPPING_ADS',
        applicableCountries: ['US']
      }]
    }
    const productsClient = {
      listProducts: jest.fn(async () => [[{
        name: 'accounts/123/products/en~US~pending-offer',
        offerId: 'pending-offer',
        contentLanguage: 'en',
        feedLabel: 'US',
        dataSource,
        productAttributes: { title: 'Pending shirt' },
        productStatus: pendingStatus
      }]])
    }
    const reportsClient = { search: jest.fn(async () => [[]]) }

    const products = await searchProductDiagnostics(
      reportsClient,
      productsClient,
      '123',
      dataSource,
      ['pending-offer']
    )

    expect(products).toEqual([expect.objectContaining({
      id: 'en~US~pending-offer',
      offerId: 'pending-offer',
      title: 'Pending shirt',
      aggregatedReportingContextStatus: 'PENDING',
      statusPerReportingContext: pendingStatus.destinationStatuses,
      diagnosticSource: 'products'
    })])
    expect(products[0].itemIssues).toEqual([expect.objectContaining({
      type: { code: 'pending_image_crawl', canonicalAttribute: 'image_link' },
      resolution: 'PENDING_PROCESSING'
    })])
    expect(summarizeProductDiagnostics(products).counts.pending).toBe(1)
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

  test('manually follows Products page tokens until all requested offers are found', async () => {
    const dataSource = 'accounts/123/dataSources/456'
    const productsClient = {
      listProducts: jest.fn()
        .mockResolvedValueOnce([[], null, { nextPageToken: 'page-2' }])
        .mockResolvedValueOnce([[
          { name: 'accounts/123/products/en~US~wanted', offerId: 'wanted', dataSource }
        ], null, { nextPageToken: 'page-3' }])
    }
    const reportsClient = {
      search: jest.fn(async () => [[{
        productView: { id: 'en~US~wanted', offerId: 'wanted' }
      }]])
    }

    const products = await searchProductDiagnostics(
      reportsClient,
      productsClient,
      '123',
      dataSource,
      ['wanted']
    )

    expect(productsClient.listProducts).toHaveBeenCalledTimes(2)
    expect(productsClient.listProducts).toHaveBeenNthCalledWith(2, {
      parent: 'accounts/123',
      pageSize: 1000,
      pageToken: 'page-2'
    }, { autoPaginate: false })
    expect(products.map(product => product.offerId)).toEqual(['wanted'])
  })

  test('manually follows Reports page tokens with auto-pagination disabled', async () => {
    const dataSource = 'accounts/123/dataSources/456'
    const productsClient = {
      listProducts: jest.fn(async () => [[
        { name: 'accounts/123/products/en~US~first', offerId: 'first', dataSource },
        { name: 'accounts/123/products/en~US~second', offerId: 'second', dataSource }
      ]])
    }
    const reportsClient = {
      search: jest.fn()
        .mockResolvedValueOnce([[
          { productView: { id: 'en~US~first', offerId: 'first' } }
        ], null, { nextPageToken: 'report-page-2' }])
        .mockResolvedValueOnce([[
          { productView: { id: 'en~US~second', offerId: 'second' } }
        ], null, {}])
    }

    const products = await searchProductDiagnostics(
      reportsClient,
      productsClient,
      '123',
      dataSource,
      ['first', 'second']
    )

    expect(reportsClient.search).toHaveBeenCalledTimes(2)
    expect(reportsClient.search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pageToken: 'report-page-2'
    }), { autoPaginate: false })
    expect(products.map(product => product.offerId)).toEqual(['first', 'second'])
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

describe('classifyProductView', () => {
  test('only classifies a Google PENDING status as pending', () => {
    expect(classifyProductView({ aggregatedReportingContextStatus: 'PENDING' })).toBe('pending')
    expect(classifyProductView({})).toBe('unknown')
  })
})
