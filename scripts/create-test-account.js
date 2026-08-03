#!/usr/bin/env node
// Creates a GMC TEST account under the prod merchant account, using the SA
// credentials in .env. Test accounts behave like production for uploads but
// NEVER publish to Search/Shopping — safe for end-to-end validation.
//
// After creating, it immediately probes getAccount on the new account to tell
// us whether the SA can already operate on it (i.e. whether the project's
// developer registration covers the test account, or a separate registerGcp
// is still needed).
//
// Limits: max 5 test accounts per Google account (Google).
//
// Usage:
//   node scripts/create-test-account.js
//   node scripts/create-test-account.js --name "Adobe Express Print TEST" --tz America/Los_Angeles --lang en-US

const fs = require('fs')
const path = require('path')
const { AccountsServiceClient } = require('@google-shopping/accounts').v1

function loadEnv () {
  const content = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}

function parseArgs (argv) {
  const args = { name: 'Adobe Express Print TEST', tz: 'America/Los_Angeles', lang: 'en-US' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--name') args.name = argv[++i]
    else if (a === '--tz') args.tz = argv[++i]
    else if (a === '--lang') args.lang = argv[++i]
    else throw new Error(`unknown arg: ${a}`)
  }
  return args
}

function isNotRegistered (err) {
  const msg = String(err && err.message || '')
  return /not registered/i.test(msg) || /AUTH_GCP_NOT_REGISTERED/.test(msg)
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const env = loadEnv()

  const prodId = env.GMC_MERCHANT_ACCOUNT_ID_PROD
  if (!prodId || prodId === '__PLACEHOLDER__') throw new Error('GMC_MERCHANT_ACCOUNT_ID_PROD not set in .env')
  const raw = env.GMC_SERVICE_ACCOUNT_JSON
  if (!raw || raw === '__PLACEHOLDER__') throw new Error('GMC_SERVICE_ACCOUNT_JSON not set in .env')
  const credentials = JSON.parse(raw)

  const accounts = new AccountsServiceClient({ credentials, scopes: ['https://www.googleapis.com/auth/content'] })

  console.log(`Creating test account under accounts/${prodId} (SA ${credentials.client_email}) ...`)
  const [created] = await accounts.createTestAccount({
    parent: `accounts/${prodId}`,
    account: {
      accountName: args.name,
      timeZone: { id: args.tz },
      languageCode: args.lang
    }
  })

  const testId = created.accountId ? String(created.accountId) : (created.name ? created.name.split('/').pop() : undefined)
  console.log('\n✅ Test account created:')
  console.log(`   name:       ${created.name}`)
  console.log(`   accountId:  ${testId}`)
  console.log(`   testAccount: ${created.testAccount}`)

  // Probe: can the SA already read the new account?
  try {
    const [acct] = await accounts.getAccount({ name: `accounts/${testId}` })
    console.log(`\nACCESS PROBE: ✅ SA can access the test account (getAccount ok — "${acct.accountName}").`)
    console.log('  => No separate registerGcp needed for the test account. Proceed.')
  } catch (e) {
    if (isNotRegistered(e)) {
      console.log('\nACCESS PROBE: ❌ AUTH_GCP_NOT_REGISTERED on the test account.')
      console.log('  => The test account needs its OWN developer registration. Register it with:')
      console.log(`     node scripts/register-gcp-oauth.js <oauth_client.json> --account ${testId}`)
      console.log('  (requires a human with Admin on the test account)')
    } else {
      console.log(`\nACCESS PROBE: getAccount error: ${e.message}`)
    }
  }

  console.log('\nNext steps:')
  console.log(`  1. Add to .env:  GMC_MERCHANT_ACCOUNT_ID_TEST=${testId}   (no quotes)`)
  console.log('  2. node scripts/check-account.js --env test   (confirm testAccount + access)')
  console.log('  3. aio app deploy')
  console.log('  4. aio runtime action invoke gmc-feed-sync/bootstrap-datasource --param env test --result')
  console.log('     -> store returned dataSourceId in .env as GMC_DATASOURCE_ID_TEST, then redeploy')
  process.exit(0)
}

main().catch(err => {
  console.error('\ncreate-test-account failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  process.exit(1)
})
