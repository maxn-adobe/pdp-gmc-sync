#!/usr/bin/env node
// Adds a human user to a GMC account via the Users API, using the SA in .env.
// Use this to grant yourself (or teammates) UI access to the test account so it
// shows up at merchants.google.com/mc/overview?a=<accountId>.
//
// Defaults to the TEST account (GMC_MERCHANT_ACCOUNT_ID_TEST) and ADMIN access.
// ADMIN is needed to manage other users; use --access standard for view/manage
// without user-management, or read_only for view-only.
//
// Usage:
//   node scripts/add-user.js maxn@adobe.com
//   node scripts/add-user.js someone@adobe.com --access standard
//   node scripts/add-user.js maxn@adobe.com --account 5830778204 --access admin

const fs = require('fs')
const path = require('path')
const { UserServiceClient } = require('@google-shopping/accounts').v1

const ACCESS = { admin: 'ADMIN', standard: 'STANDARD', read_only: 'READ_ONLY' }

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
  const args = { email: null, account: null, access: 'admin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--account') args.account = argv[++i]
    else if (a === '--access') args.access = String(argv[++i]).toLowerCase()
    else if (!args.email) args.email = a
    else throw new Error(`unexpected arg: ${a}`)
  }
  if (!args.email) throw new Error('provide the user email as the first argument')
  if (!ACCESS[args.access]) throw new Error(`--access must be one of: ${Object.keys(ACCESS).join(', ')}`)
  return args
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const env = loadEnv()

  const accountId = args.account || env.GMC_MERCHANT_ACCOUNT_ID_TEST
  if (!accountId || accountId === '__PLACEHOLDER__') {
    throw new Error('no account id — pass --account <id> or set GMC_MERCHANT_ACCOUNT_ID_TEST in .env')
  }
  const raw = env.GMC_SERVICE_ACCOUNT_JSON
  if (!raw || raw === '__PLACEHOLDER__') throw new Error('GMC_SERVICE_ACCOUNT_JSON not set in .env')
  const credentials = JSON.parse(raw)

  const users = new UserServiceClient({ credentials, scopes: ['https://www.googleapis.com/auth/content'] })
  const accessRight = ACCESS[args.access]

  console.log(`Adding ${args.email} to accounts/${accountId} with ${accessRight} access ...`)
  const [user] = await users.createUser({
    parent: `accounts/${accountId}`,
    userId: args.email,
    user: { accessRights: [accessRight] }
  })

  console.log('\n✅ User created:')
  console.log(`   name:         ${user.name}`)
  console.log(`   state:        ${user.state}`)
  console.log(`   accessRights: ${JSON.stringify(user.accessRights)}`)
  if (String(user.state).toUpperCase() === 'PENDING') {
    console.log('\n   State is PENDING — check that email for a Merchant Center invite and accept it.')
  }
  console.log(`\nThen open: https://merchants.google.com/mc/overview?a=${accountId}`)
  process.exit(0)
}

main().catch(err => {
  console.error('\nadd-user failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  const msg = String(err && err.message)
  if (/ALREADY_EXISTS/i.test(msg)) console.error('(This user may already be on the account.)')
  process.exit(1)
})
