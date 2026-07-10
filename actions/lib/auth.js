const { OAuth2Client, GoogleAuth } = require('google-auth-library')

const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'
const PLACEHOLDER = '__PLACEHOLDER__'

function isPlaceholder (v) {
  return v === undefined || v === null || v === '' || v === PLACEHOLDER
}

function getAuthClient (params) {
  if (params.GMC_SERVICE_ACCOUNT_JSON && !isPlaceholder(params.GMC_SERVICE_ACCOUNT_JSON)) {
    let credentials
    try {
      credentials = typeof params.GMC_SERVICE_ACCOUNT_JSON === 'string'
        ? JSON.parse(params.GMC_SERVICE_ACCOUNT_JSON)
        : params.GMC_SERVICE_ACCOUNT_JSON
    } catch (e) {
      throw new Error('GMC_SERVICE_ACCOUNT_JSON is not valid JSON')
    }
    return new GoogleAuth({ credentials, scopes: [CONTENT_SCOPE] })
  }

  const id = params.GMC_CLIENT_ID
  const secret = params.GMC_CLIENT_SECRET
  const refresh = params.GMC_REFRESH_TOKEN
  if (isPlaceholder(id) || isPlaceholder(secret) || isPlaceholder(refresh)) {
    throw new Error('GMC credentials not configured: need GMC_CLIENT_ID, GMC_CLIENT_SECRET, GMC_REFRESH_TOKEN (or GMC_SERVICE_ACCOUNT_JSON).')
  }

  const client = new OAuth2Client({ clientId: id, clientSecret: secret })
  client.setCredentials({ refresh_token: refresh })
  return client
}

module.exports = { getAuthClient, CONTENT_SCOPE, isPlaceholder }
