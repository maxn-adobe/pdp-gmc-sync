const { redact } = require('../../actions/lib/redact')

describe('redact', () => {
  test('hides all GMC credential keys', () => {
    const s = redact({
      GMC_CLIENT_ID: 'cid',
      GMC_CLIENT_SECRET: 'sss',
      GMC_REFRESH_TOKEN: 'rrr',
      GMC_SERVICE_ACCOUNT_JSON: '{"private_key":"pk"}',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x/y/z',
      env: 'test'
    })
    expect(s).not.toMatch(/cid|sss|rrr|"pk"|hooks\.slack\.com/)
    expect(s).toMatch(/"env":"test"/)
    expect(s).toMatch(/"GMC_CLIENT_SECRET":"<hidden>"/)
  })

  test('hides authorization header via stringParameters', () => {
    const s = redact({ __ow_headers: { authorization: 'Bearer supersecret' } })
    expect(s).not.toMatch(/supersecret/)
    expect(s).toMatch(/"authorization":"<hidden>"/)
  })

  test('lowercase authorization key at top level is redacted', () => {
    const s = redact({ authorization: 'plaintext' })
    expect(s).not.toMatch(/plaintext/)
  })

  test('non-secret values pass through', () => {
    const s = redact({ a: 1, b: 'ok', env: 'prod' })
    expect(s).toMatch(/"a":1/)
    expect(s).toMatch(/"env":"prod"/)
  })
})
