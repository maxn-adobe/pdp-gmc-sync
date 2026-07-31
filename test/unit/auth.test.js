const { getAuthClient } = require('../../actions/lib/auth')
const { GoogleAuth } = require('google-auth-library')

const validServiceAccount = {
  type: 'service_account',
  project_id: 'adbe-gcp1060',
  private_key_id: 'fake-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  client_email: 'express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com'
}

describe('getAuthClient', () => {
  test('throws when GMC_SERVICE_ACCOUNT_JSON is missing', () => {
    expect(() => getAuthClient({})).toThrow(/GMC_SERVICE_ACCOUNT_JSON/)
  })

  test('builds a GoogleAuth client from the service account JSON (string)', () => {
    const client = getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: JSON.stringify(validServiceAccount)
    })

    expect(client).toBeInstanceOf(GoogleAuth)
  })

  test('accepts an already-parsed object for GMC_SERVICE_ACCOUNT_JSON', () => {
    const client = getAuthClient({ GMC_SERVICE_ACCOUNT_JSON: validServiceAccount })
    expect(client).toBeInstanceOf(GoogleAuth)
  })

  test('throws helpful error on malformed JSON', () => {
    expect(() => getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: '{not json'
    })).toThrow(/not valid JSON/)
  })

  test('rejects JSON missing required service-account fields', () => {
    expect(() => getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: { type: 'service_account', project_id: 'adbe-gcp1060' }
    })).toThrow(/must be a service_account key/)
  })

  test('rejects a non-service-account credential (e.g. an OAuth client blob)', () => {
    expect(() => getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: {
        web: { client_id: 'x', client_secret: 'y' }
      }
    })).toThrow(/must be a service_account key/)
  })

  test('rejects a service account whose project does not match GMC_GCP_PROJECT_ID', () => {
    expect(() => getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: validServiceAccount,
      GMC_GCP_PROJECT_ID: 'different-project'
    })).toThrow(/project does not match/)
  })

  test('accepts a service account whose project matches GMC_GCP_PROJECT_ID', () => {
    const client = getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: validServiceAccount,
      GMC_GCP_PROJECT_ID: 'adbe-gcp1060'
    })
    expect(client).toBeInstanceOf(GoogleAuth)
  })

  test('rejects a service account whose client_email does not match GMC_SERVICE_ACCOUNT_EMAIL', () => {
    expect(() => getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: validServiceAccount,
      GMC_SERVICE_ACCOUNT_EMAIL: 'someone-else@adbe-gcp1060.iam.gserviceaccount.com'
    })).toThrow(/email does not match/)
  })

  test('accepts a service account whose client_email matches GMC_SERVICE_ACCOUNT_EMAIL', () => {
    const client = getAuthClient({
      GMC_SERVICE_ACCOUNT_JSON: validServiceAccount,
      GMC_SERVICE_ACCOUNT_EMAIL: validServiceAccount.client_email
    })
    expect(client).toBeInstanceOf(GoogleAuth)
  })
})
