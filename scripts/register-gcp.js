#!/usr/bin/env node
// One-off admin script for Merchant API developerRegistration calls. Runs
// locally against the SA credentials in .env — not deployed as an Adobe I/O
// action.
//
// IMPORTANT: `registerGcp` REJECTS service-account callers with
// PERMISSION_DENIED_TO_REGISTER_GCP_WITH_SERVICE_ACCOUNT. The initial GCP
// registration must be done by a human Google identity via Google's API
// Explorer:
//   https://developers.google.com/merchant/api/reference/rest/accounts_v1beta/accounts.developerRegistration/registerGcp
// This script is retained for `--unregister` (which the SA CAN call) and for
// `--env test` once the test account is provisioned.
//
// Usage:
//   node scripts/register-gcp.js --unregister              # SA can reverse a prior registration
//   node scripts/register-gcp.js --env test                # attempts register (will fail w/ SA — see above)
//   node scripts/register-gcp.js --email foo@bar           # override developerEmail (default: SA client_email)

const fs = require('fs')
const path = require('path')
const { DeveloperRegistrationServiceClient } = require('@google-shopping/accounts').v1

function loadEnv () {
  const envPath = path.join(__dirname, '..', '.env')
  const content = fs.readFileSync(envPath, 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return env
}

function parseArgs (argv) {
  const args = { env: 'prod', unregister: false, developerEmail: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--unregister') args.unregister = true
    else if (a === '--env') args.env = argv[++i]
    else if (a === '--email') args.developerEmail = argv[++i]
    else throw new Error(`unknown arg: ${a}`)
  }
  if (!['test', 'prod'].includes(args.env)) {
    throw new Error(`--env must be 'test' or 'prod' (got: ${args.env})`)
  }
  return args
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const env = loadEnv()

  const raw = env.GMC_SERVICE_ACCOUNT_JSON
  if (!raw || raw === '__PLACEHOLDER__') {
    throw new Error('GMC_SERVICE_ACCOUNT_JSON not set in .env')
  }
  let credentials
  try {
    credentials = JSON.parse(raw)
  } catch (e) {
    throw new Error('GMC_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message)
  }

  const accountKey = args.env === 'test' ? 'GMC_MERCHANT_ACCOUNT_ID_TEST' : 'GMC_MERCHANT_ACCOUNT_ID_PROD'
  const accountId = env[accountKey]
  if (!accountId || accountId === '__PLACEHOLDER__') {
    throw new Error(`${accountKey} not set in .env`)
  }

  const client = new DeveloperRegistrationServiceClient({
    credentials,
    scopes: ['https://www.googleapis.com/auth/content']
  })

  const name = `accounts/${accountId}/developerRegistration`

  if (args.unregister) {
    console.log(`Unregistering ${name} ...`)
    await client.unregisterGcp({ name })
    console.log('Unregistered.')
    return
  }

  const developerEmail = args.developerEmail || credentials.client_email
  console.log(`Registering ${name} with developerEmail=${developerEmail} ...`)
  const [reg] = await client.registerGcp({ name, developerEmail })
  console.log('Registered:')
  console.log(JSON.stringify(reg, null, 2))
  console.log('\nGoogle needs ~5 minutes to propagate. Then re-run bootstrap-datasource.')
}

main().catch(err => {
  console.error('\nregisterGcp failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  if (err.statusDetails) console.error('statusDetails:', JSON.stringify(err.statusDetails, null, 2))
  process.exit(1)
})
