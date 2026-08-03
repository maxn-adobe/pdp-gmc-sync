const mockAuth = { __brand: 'fake-google-auth', getUniverseDomain: jest.fn(async () => 'googleapis.com') }

jest.mock('../../actions/lib/auth', () => ({
  getAuthClient: jest.fn(() => mockAuth)
}))

const { getAuthClient } = require('../../actions/lib/auth')
const { ProductInputsServiceClient, ProductsServiceClient } = require('@google-shopping/products').v1
const { DataSourcesServiceClient } = require('@google-shopping/datasources').v1
const { ReportServiceClient } = require('@google-shopping/reports').v1
const { makeClients } = require('../../actions/lib/gmcClients')

describe('makeClients', () => {
  beforeEach(() => {
    getAuthClient.mockClear()
  })

  test('calls getAuthClient exactly once and shares that auth across every client', () => {
    const clients = makeClients({ GMC_SERVICE_ACCOUNT_JSON: '{}' })

    expect(getAuthClient).toHaveBeenCalledTimes(1)
    for (const client of [clients.productInputs, clients.products, clients.dataSources, clients.reports]) {
      expect(client.auth).toBe(mockAuth)
    }
  })

  // Regression: google-gax's GrpcClient.createStub calls auth.getUniverseDomain() when
  // constructing every GAPIC stub. A bare OAuth2Client/JWT client doesn't have this
  // method — only GoogleAuth does — which is why getAuthClient() must return a
  // GoogleAuth instance (verified for real in auth.test.js); here we just confirm
  // gmcClients.js passes that auth straight through instead of re-wrapping it.
  test('the shared auth resolves a universe domain', async () => {
    const clients = makeClients({ GMC_SERVICE_ACCOUNT_JSON: '{}' })
    await expect(clients.productInputs.auth.getUniverseDomain()).resolves.toBe('googleapis.com')
  })

  test('constructs all four service clients', () => {
    const clients = makeClients({ GMC_SERVICE_ACCOUNT_JSON: '{}' })
    expect(clients.productInputs).toBeInstanceOf(ProductInputsServiceClient)
    expect(clients.products).toBeInstanceOf(ProductsServiceClient)
    expect(clients.dataSources).toBeInstanceOf(DataSourcesServiceClient)
    expect(clients.reports).toBeInstanceOf(ReportServiceClient)
  })
})
