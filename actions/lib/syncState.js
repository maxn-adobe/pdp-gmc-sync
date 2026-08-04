const stateLib = require('@adobe/aio-lib-state')

// Comfortably past Google's documented "several minutes" reprocessing delay
// after an insert/update — long enough that a miss here always means either
// "never pushed via sync-products" or "pushed so long ago it's surely
// resolved by now," never "still mid-reprocessing."
const TTL_SECONDS = 60 * 60 * 24

// State keys must match /^[a-zA-Z0-9-_.]{1,1024}$/ — env/accountId/offerId
// can contain arbitrary characters (offerIds especially, e.g. ':' or '/'),
// so each part is base64url-encoded (alphabet is exactly a-zA-Z0-9-_, no
// padding) before being joined with '.', which the raw values never are.
function encodeKeyPart (value) {
  return Buffer.from(String(value), 'utf8').toString('base64url')
}

function pushedAtKey (env, accountId, offerId) {
  return `pushed_at.${encodeKeyPart(env)}.${encodeKeyPart(accountId)}.${encodeKeyPart(offerId)}`
}

// Best-effort only. A State outage must never break sync-products or
// diagnostics — every caller here fails open (returns null/false) rather
// than throwing, so this is always safe to call unconditionally.
async function initState (logger) {
  try {
    const state = await stateLib.init()
    if (!state?.namespace) {
      if (logger?.error) logger.error('syncState.initState: connected but namespace is empty — check AIO_runtime_namespace/AIO_runtime_auth (state reads/writes may be silently inconsistent)')
    } else if (logger?.info) {
      logger.info(`syncState.initState: connected, namespace=${state.namespace}`)
    }
    return state
  } catch (e) {
    if (logger?.error) logger.error(`State.init failed: ${e.message}`)
    return null
  }
}

async function recordPushes (state, env, accountId, offerIds, logger) {
  if (!state || !offerIds.length) return
  const now = String(Date.now())
  const keys = offerIds.map(offerId => pushedAtKey(env, accountId, offerId))
  const results = await Promise.allSettled(
    keys.map(key => state.put(key, now, { ttl: TTL_SECONDS }))
  )
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      if (logger?.error) logger.error(`syncState.recordPushes failed for key=${keys[i]}: ${r.reason?.message}`)
    }
  })
}

// Shared by isStale below and diagnostics.js's isRecentlyPushed — both just
// need "when did we last record a push for this offerId" and compare it
// against a different reference point. Fails open (null) on a missing
// offerId, unparseable value, or a State outage.
async function getPushedAt (state, env, accountId, offerId, logger) {
  if (!state) return null
  const key = pushedAtKey(env, accountId, offerId)
  try {
    const entry = await state.get(key)
    if (!entry || entry.value == null) return null
    const pushedAt = Number(entry.value)
    return Number.isFinite(pushedAt) ? pushedAt : null
  } catch (e) {
    if (logger?.error) logger.error(`syncState.getPushedAt: state.get failed for key=${key}: ${e.message}`)
    return null
  }
}

// A product is "stale" if Google's processed status was last computed
// *before* our last recorded push for this offerId — i.e. the caller already
// fixed and resubmitted, but Google hasn't reprocessed the new version yet.
// Fails open (false) on any missing/unparseable data, a State outage, or an
// offerId we never recorded a push for — in every one of those cases there's
// no basis for suspecting staleness, so callers should just trust Google's
// returned status as-is.
async function isStale (state, env, accountId, offerId, product, logger) {
  const lastUpdateDate = product?.productStatus?.lastUpdateDate
  if (!lastUpdateDate) return false
  const lastUpdateMs = new Date(lastUpdateDate).getTime()
  if (Number.isNaN(lastUpdateMs)) return false
  const pushedAt = await getPushedAt(state, env, accountId, offerId, logger)
  if (pushedAt == null) return false
  return lastUpdateMs < pushedAt
}

module.exports = { initState, recordPushes, isStale, getPushedAt, pushedAtKey, TTL_SECONDS }
