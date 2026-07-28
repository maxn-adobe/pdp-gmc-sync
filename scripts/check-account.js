#!/usr/bin/env node
// Read-only diagnostic. Uses the SA credentials in .env to probe the Merchant
// account. Answers three questions with zero side effects:
//   1. Is the GCP project registered? (developerRegistration.get / getAccount)
//   2. Is this account standalone or advanced? (listSubAccounts)
//   3. Is it flagged as a test account? (getAccount -> testAccount)
//
// Usage:
//   node scripts/check-account.js            # probe PROD merchant account
//   node scripts/check-account.js --env test # probe TEST merchant account

const fs = require('fs')
const path = require('path')
const { AccountsServiceClient, DeveloperRegistrationServiceClient } = require('@google-shopping/accounts').v1

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

function isNotRegistered (err) {
  const msg = String(err && err.message || '')
  return /not registered/i.test(msg) || /AUTH_GCP_NOT_REGISTERED/.test(msg)
}

async function main () {
  const env = loadEnv()
  const useTest = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'test'
  const accountId = useTest ? env.GMC_MERCHANT_ACCOUNT_ID_TEST : env.GMC_MERCHANT_ACCOUNT_ID_PROD
  if (!accountId || accountId === '__PLACEHOLDER__') {
    throw new Error(`${useTest ? 'GMC_MERCHANT_ACCOUNT_ID_TEST' : 'GMC_MERCHANT_ACCOUNT_ID_PROD'} not set in .env`)
  }
  const raw = env.GMC_SERVICE_ACCOUNT_JSON
  if (!raw || raw === '__PLACEHOLDER__') throw new Error('GMC_SERVICE_ACCOUNT_JSON not set in .env')
  const credentials = JSON.parse(raw)
  const authOpts = { credentials, scopes: ['https://www.googleapis.com/auth/content'] }

  const accounts = new AccountsServiceClient(authOpts)
  const devReg = new DeveloperRegistrationServiceClient(authOpts)

  console.log(`Probing accounts/${accountId} with SA ${credentials.client_email}\n`)

  // 1. Account (also the definitive registration probe)
  let registered = null
  try {
    const [acct] = await accounts.getAccount({ name: `accounts/${accountId}` })
    registered = true
    console.log('REGISTRATION: ✅ registered (getAccount succeeded)')
    console.log(`ACCOUNT NAME: ${acct.accountName}`)
    console.log(`TEST ACCOUNT: ${acct.testAccount ? 'YES — this is a test account' : 'no (production account)'}`)
  } catch (e) {
    if (isNotRegistered(e)) {
      registered = false
      console.log('REGISTRATION: ❌ NOT registered — registerGcp still needs to complete.')
      console.log(`  (${e.message})`)
    } else {
      console.log(`getAccount error: ${e.message}`)
    }
  }

  // 2. Registration record (best-effort detail)
  try {
    const [reg] = await devReg.getDeveloperRegistration({ name: `accounts/${accountId}/developerRegistration` })
    console.log(`DEV REGISTRATION RECORD: ${JSON.stringify(reg)}`)
  } catch (e) {
    if (!isNotRegistered(e)) console.log(`getDeveloperRegistration: ${e.message}`)
  }

  // 3. Standalone vs advanced
  if (registered) {
    try {
      const [subs] = await accounts.listSubAccounts({ provider: `accounts/${accountId}` })
      if (subs && subs.length) {
        console.log(`ACCOUNT TYPE: ⚠️  ADVANCED (multi-client) — ${subs.length} sub-account(s):`)
        for (const s of subs) console.log(`  - ${s.accountName} (${s.name})`)
        console.log('  NOTE: products/data sources belong on a SUB-account, not this manager account.')
        console.log('        GMC_MERCHANT_ACCOUNT_ID_* likely needs to point at a sub-account.')
      } else {
        console.log('ACCOUNT TYPE: ✅ STANDALONE (no sub-accounts) — matches the code\'s assumption.')
      }
    } catch (e) {
      console.log(`listSubAccounts: ${e.message} (often means standalone / no provider relationship)`)
    }
  }
}

main().catch(err => {
  console.error('\ncheck-account failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  process.exit(1)
})
