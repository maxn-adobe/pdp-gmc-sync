#!/usr/bin/env node
// Local smoke-test runner for the sync-products action. Loads .env, builds the
// params the action expects (including a dummy Authorization header so the
// action's checkMissingRequestInputs passes), and calls the REAL action main()
// against the TEST account via the service account.
//
// HARD-CODED to env='test' — this runner can never touch prod.
//
// It exercises the exact production code path (validate -> mapProduct ->
// insertWithRetry -> Google ProductInputs client), just without the deployed
// HTTP/adobe-auth layer (that layer is validated separately for the browser
// integration).
//
// Usage:
//   node scripts/sync-test.js                       # uses scripts/sample-products.json
//   node scripts/sync-test.js ./my-products.json    # custom payload (array, or {products:[...]})

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

async function main () {
  const env = loadEnv()

  if (!env.GMC_DATASOURCE_ID_TEST || env.GMC_DATASOURCE_ID_TEST === '__PLACEHOLDER__') {
    throw new Error('GMC_DATASOURCE_ID_TEST not set in .env — run bootstrap-datasource --param env test first and store the id.')
  }

  const samplePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'sample-products.json')
  const raw = JSON.parse(fs.readFileSync(samplePath, 'utf-8'))
  const products = Array.isArray(raw) ? raw : raw.products
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error(`${samplePath} must be a non-empty array of product rows (or {"products":[...]})`)
  }

  const { main: syncProducts } = require(path.join(__dirname, '..', 'actions', 'sync-products', 'index.js'))

  const params = {
    ...env, // GMC_SERVICE_ACCOUNT_JSON, GMC_MERCHANT_ACCOUNT_ID_TEST, GMC_DATASOURCE_ID_TEST, LOG_LEVEL, ...
    env: 'test', // hard-coded: test only
    products,
    __ow_headers: { authorization: 'Bearer local-runner' },
    LOG_LEVEL: env.LOG_LEVEL || 'info'
  }

  console.log(`Running sync-products against TEST account ${env.GMC_MERCHANT_ACCOUNT_ID_TEST}, data source ${env.GMC_DATASOURCE_ID_TEST}`)
  console.log(`Submitting ${products.length} product(s) from ${path.relative(process.cwd(), samplePath)} ...\n`)

  const res = await syncProducts(params)
  console.log(JSON.stringify(res, null, 2))

  const body = res && res.body
  if (body && typeof body.succeeded === 'number') {
    console.log(`\nsubmitted=${body.submitted} succeeded=${body.succeeded} failed=${body.failed}`)
    console.log('\nNote: an "ok" insert means ACCEPTED. Google processes async (minutes) — run diagnostics next to read processed status.')
  }
  process.exit(0)
}

main().catch(err => {
  console.error('\nsync-test failed:', err.message || err)
  process.exit(1)
})
