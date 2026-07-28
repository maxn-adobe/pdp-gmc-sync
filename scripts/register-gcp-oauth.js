#!/usr/bin/env node
// Registers THIS GCP project against the GMC account by running a one-time
// HUMAN OAuth 2.0 authorization-code flow using YOUR OWN OAuth client
// credentials (the "OAuth 2.0 Client ID" you created in GCP project
// adbe-gcp1060 and downloaded as JSON).
//
// WHY THIS EXISTS — every other path is rejected by Google:
//   - Service account  -> PERMISSION_DENIED_TO_REGISTER_GCP_WITH_SERVICE_ACCOUNT
//                         (must be a human user)
//   - API Explorer /   -> PERMISSION_DENIED_REGISTER_SHARED_GCP_ID
//     OAuth Playground     (token belongs to Google's shared project, not yours)
//   Google requires a token minted from YOUR project's OAuth client, authorized
//   by a HUMAN who has GMC Admin. That is exactly what this script produces.
//
//   One-time ADMIN action. The token is used once and discarded. The deployed
//   service still authenticates with the SERVICE ACCOUNT — this does not change
//   the app's runtime auth.
//
// PREREQUISITES:
//   1. An OAuth 2.0 Client ID in GCP project adbe-gcp1060
//      (APIs & Services -> Credentials). "Desktop app" type is easiest — it
//      allows the loopback redirect automatically. If it is a "Web application"
//      client, add this EXACT authorized redirect URI:
//          http://localhost:3000/oauth2callback
//   2. The signing-in user must have Admin on the GMC account (maxn@adobe.com).
//   3. If the OAuth consent screen is in "Testing" status, add the signing-in
//      user as a Test user (or set the app to Internal). Expect an
//      "unverified app" warning — Advanced -> Go to <app> to proceed.
//
// USAGE:
//   node scripts/register-gcp-oauth.js <path-to-oauth_client.json>
//   node scripts/register-gcp-oauth.js <path> --email maxn@adobe.com
//   node scripts/register-gcp-oauth.js <path> --account 5526153791 --port 3000

const fs = require('fs')
const path = require('path')
const http = require('http')
const { URL } = require('url')
const { OAuth2Client, GoogleAuth } = require('google-auth-library')
const { DeveloperRegistrationServiceClient } = require('@google-shopping/accounts').v1

const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'

function parseArgs (argv) {
  const args = { clientPath: null, email: 'maxn@adobe.com', account: null, port: 3000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--email') args.email = argv[++i]
    else if (a === '--account') args.account = argv[++i]
    else if (a === '--port') args.port = parseInt(argv[++i], 10)
    else if (!args.clientPath) args.clientPath = a
    else throw new Error(`unexpected arg: ${a}`)
  }
  if (!args.clientPath) throw new Error('provide the path to your OAuth client JSON as the first argument')
  return args
}

function loadEnvProdAccount () {
  try {
    const content = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (t.startsWith('GMC_MERCHANT_ACCOUNT_ID_PROD=')) {
        const v = t.slice(t.indexOf('=') + 1).trim()
        if (v && v !== '__PLACEHOLDER__') return v
      }
    }
  } catch (e) { /* ignore */ }
  return null
}

function loadOAuthClient (p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
  const cfg = raw.installed || raw.web || raw
  if (!cfg.client_id || !cfg.client_secret) {
    throw new Error('That JSON has no client_id/client_secret — it should be an "OAuth 2.0 Client ID" download, NOT the service-account key.')
  }
  return { clientId: cfg.client_id, clientSecret: cfg.client_secret }
}

function waitForCode (authUrl, redirectUri, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, `http://localhost:${port}`)
        if (u.pathname !== '/oauth2callback') { res.statusCode = 204; res.end(); return }
        const code = u.searchParams.get('code')
        const err = u.searchParams.get('error')
        res.setHeader('Content-Type', 'text/plain')
        res.end('Done — you can close this tab and return to the terminal.')
        server.close()
        if (err) return reject(new Error(`OAuth consent error: ${err}`))
        if (!code) return reject(new Error('no authorization code returned'))
        resolve(code)
      } catch (e) { reject(e) }
    })
    server.on('error', e => reject(
      e.code === 'EADDRINUSE'
        ? new Error(`port ${port} is in use — rerun with --port <free-port> (and register that redirect URI)`)
        : e
    ))
    server.listen(port, () => {
      console.log('\n1) Open this URL in a browser signed in as your GMC-Admin account:\n')
      console.log('   ' + authUrl + '\n')
      console.log(`2) Approve consent. Waiting for the redirect on ${redirectUri} ...`)
    })
  })
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const account = args.account || loadEnvProdAccount()
  if (!account) throw new Error('no account id — pass --account <id> or set GMC_MERCHANT_ACCOUNT_ID_PROD in .env')
  const redirectUri = `http://localhost:${args.port}/oauth2callback`
  const { clientId, clientSecret } = loadOAuthClient(args.clientPath)

  const oAuth2Client = new OAuth2Client(clientId, clientSecret, redirectUri)
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'online', prompt: 'consent', scope: [CONTENT_SCOPE] })

  const code = await waitForCode(authUrl, redirectUri, args.port)
  const { tokens } = await oAuth2Client.getToken(code)
  oAuth2Client.setCredentials(tokens)
  console.log('\n3) Got a user token from your project. Calling registerGcp ...')

  // GAPIC clients call auth.getUniverseDomain(); a bare OAuth2Client lacks it in
  // google-auth-library v10, so wrap it in GoogleAuth (which implements it and
  // returns our token-bearing client from getClient()).
  const auth = new GoogleAuth({ authClient: oAuth2Client })
  const devReg = new DeveloperRegistrationServiceClient({ auth })
  const name = `accounts/${account}/developerRegistration`
  const [reg] = await devReg.registerGcp({ name, developerEmail: args.email })

  console.log('\n✅ Registered:')
  console.log(JSON.stringify(reg, null, 2))
  console.log('\nWait ~5 minutes for propagation, then verify:  node scripts/check-account.js')
  process.exit(0)
}

main().catch(err => {
  console.error('\nregister-gcp-oauth failed:', err.message || err)
  if (err.code !== undefined) console.error('code:', err.code)
  const msg = String(err && err.message)
  if (/redirect_uri_mismatch/.test(msg)) {
    console.error('\nFIX: your OAuth client does not allow the redirect URI this script used.')
    console.error('  Either create a "Desktop app" OAuth client (loopback allowed automatically),')
    console.error('  or add the exact redirect URI printed above to the client\'s Authorized redirect URIs.')
  }
  if (/PERMISSION_DENIED_REGISTER_SHARED_GCP_ID/.test(msg)) {
    console.error('\nThis means the token still came from a shared project — make sure you passed YOUR own OAuth client JSON.')
  }
  process.exit(1)
})
