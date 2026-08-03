#!/usr/bin/env node
// Inspects and (with --accept) accepts the Merchant Center Terms of Service for
// an account — driven by the account's ACTUAL agreement state, not just the
// "latest" ToS. Accepting "latest" (termsOfService/135) did NOT clear the
// required ToS for test account 5830778204, so we read what the account marks
// as `required` and accept exactly that.
//
// Default (READ-ONLY): retrieveForApplicationTermsOfServiceAgreementState ->
//   prints accepted{} and required{} (resource names + tosFileUri to review).
// --accept: accepts the ToS named in required{}, then re-reads state to confirm.
//   (Accepting ToS is a legal action; you already consented to accepting the
//   Merchant Center ToS — this just targets the correct resource.)
//
// Usage:
//   node scripts/accept-tos.js --account 5830778204            # review only
//   node scripts/accept-tos.js --account 5830778204 --accept   # accept the required ToS

const fs = require('fs')
const path = require('path')
const {
  TermsOfServiceServiceClient,
  TermsOfServiceAgreementStateServiceClient
} = require('@google-shopping/accounts').v1

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
  const args = { account: null, region: 'US', accept: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--accept') args.accept = true
    else if (a === '--account') args.account = argv[++i]
    else if (a === '--region') args.region = argv[++i]
    else throw new Error(`unknown arg: ${a}`)
  }
  return args
}

async function readState (stateClient, parent) {
  const [state] = await stateClient.retrieveForApplicationTermsOfServiceAgreementState({ parent })
  return state
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
  const authOpts = { credentials, scopes: ['https://www.googleapis.com/auth/content'] }

  const stateClient = new TermsOfServiceAgreementStateServiceClient(authOpts)
  const tosClient = new TermsOfServiceServiceClient(authOpts)
  const parent = `accounts/${accountId}`

  console.log(`Reading ToS agreement state for ${parent} ...\n`)
  let state
  try {
    state = await readState(stateClient, parent)
  } catch (e) {
    console.error('Could not read agreement state:', e.message)
    console.error('(If this is itself blocked by "ToS not signed", tell me — we may need getTermsOfServiceAgreementState with an explicit identifier instead.)')
    throw e
  }
  console.log(JSON.stringify(state, null, 2))

  const accepted = state && state.accepted
  const required = state && state.required
  if (accepted && accepted.termsOfService) {
    console.log(`\nACCEPTED: ${accepted.termsOfService}  validUntil=${JSON.stringify(accepted.validUntil) || 'n/a'}`)
  }
  if (required && required.termsOfService) {
    console.log(`REQUIRED: ${required.termsOfService}`)
    console.log(`  terms text: ${required.tosFileUri}`)
  } else {
    console.log('\nNo ToS currently REQUIRED for this account — looks satisfied. Try check-account.js --env test again.')
    process.exit(0)
  }

  if (!args.accept) {
    console.log('\nREVIEW ONLY — nothing accepted. Re-run with --accept to accept the REQUIRED ToS above:')
    console.log(`   node scripts/accept-tos.js --account ${accountId} --accept`)
    process.exit(0)
  }

  const region = state.regionCode || args.region
  console.log(`\nAccepting ${required.termsOfService} for ${parent} (region ${region}) ...`)
  await tosClient.acceptTermsOfService({ name: required.termsOfService, account: parent, regionCode: region })
  console.log('accept call returned OK — re-reading state ...\n')

  const after = await readState(stateClient, parent)
  console.log(JSON.stringify(after, null, 2))
  if (after && after.required && after.required.termsOfService) {
    console.log('\n⚠️  Still REQUIRED after accept. Likely propagation lag — wait 1–2 min and run: node scripts/check-account.js --env test')
    console.log('    If it persists, this is a test-account ToS quirk worth raising with Google support.')
  } else {
    console.log('\n✅ ToS requirement cleared. Next: node scripts/check-account.js --env test')
  }
  process.exit(0)
}

main().catch(err => {
  console.error('\naccept-tos failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  process.exit(1)
})
