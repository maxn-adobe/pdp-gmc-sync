#!/usr/bin/env node
// Local runner for the diagnostics action against the TEST account. Reads the
// same sample file used for the sync, derives the (sanitized) offerIds, and
// asks the action for each product's processed status.
//
// HARD-CODED to env='test'.
//
// Google processes inserts asynchronously (minutes). If products come back
// status "error" with NOT_FOUND right after a sync, wait 2-5 min and re-run.
// On a test account, once processed they should be "active" (offers auto-approve).
//
// Usage:
//   node scripts/diagnostics-test.js                    # uses scripts/sample-products.json
//   node scripts/diagnostics-test.js ./my-products.json

const fs = require('fs')
const path = require('path')

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

// mirror sanitizeOfferId from actions/lib/mapProduct.js
const sanitize = (id) => String(id ?? '').trim().replace(/:/g, '-')

async function main () {
  const env = loadEnv()

  const samplePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'sample-products.json')
  const raw = JSON.parse(fs.readFileSync(samplePath, 'utf-8'))
  const products = Array.isArray(raw) ? raw : raw.products
  const offerIds = products.map(p => sanitize(p.product_id)).filter(Boolean)
  if (offerIds.length === 0) throw new Error('no offerIds derived from the sample file')

  const { main: diagnostics } = require(path.join(__dirname, '..', 'actions', 'diagnostics', 'index.js'))

  const params = {
    ...env,
    env: 'test', // hard-coded: test only
    offerIds,
    __ow_headers: { authorization: 'Bearer local-runner' },
    LOG_LEVEL: env.LOG_LEVEL || 'info'
  }

  console.log(`Diagnostics for TEST account ${env.GMC_MERCHANT_ACCOUNT_ID_TEST}, offerIds:\n  ${offerIds.join('\n  ')}\n`)

  const res = await diagnostics(params)
  console.log(JSON.stringify(res, null, 2))

  const body = res && res.body
  if (body && body.counts) {
    const c = body.counts
    console.log(`\ncounts -> active:${c.active} pending:${c.pending} disapproved:${c.disapproved} unknown:${c.unknown} error:${c.error}`)
    if (c.error > 0) {
      console.log('(error usually = NOT_FOUND: Google has not finished processing yet. Wait a few minutes and re-run.)')
    }
  }
  process.exit(0)
}

main().catch(err => {
  console.error('\ndiagnostics-test failed:', err.message || err)
  process.exit(1)
})
