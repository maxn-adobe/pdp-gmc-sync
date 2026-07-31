const { stringParameters } = require('../utils')

const SECRET_KEYS = new Set([
  'gmc_service_account_json',
  'slack_webhook_url',
  'authorization',
  'access_token',
  'refresh_token',
  'client_secret'
])

function redact (params) {
  const clone = { ...params }
  for (const k of Object.keys(clone)) {
    if (SECRET_KEYS.has(k.toLowerCase())) clone[k] = '<hidden>'
  }
  return stringParameters(clone)
}

module.exports = { redact }
