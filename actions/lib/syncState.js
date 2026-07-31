const stateLib = require('@adobe/aio-lib-state')

// Comfortably past Google's documented "several minutes" reprocessing delay
// after an insert/update — long enough that a miss here always means either
// "never pushed via sync-products" or "pushed so long ago it's surely
// resolved by now," never "still mid-reprocessing."
const TTL_SECONDS = 60 * 60 * 24

function pushedAtKey (env, accountId, offerId) {
  return `pushed_at:${env}:${accountId}:${offerId}`
}

// Best-effort only. A State outage must never break sync-products or
// diagnostics — every caller here fails open (returns null/false) rather
// than throwing, so this is always safe to call unconditionally.
async function initState (logger) {
  try {
    return await stateLib.init()
  } catch (e) {
    if (logger?.error) logger.error(`State.init failed: ${e.message}`)
    return null
  }
}

async function recordPushes (state, env, accountId, offerIds, logger) {
  if (!state || !offerIds.length) return
  const now = String(Date.now())
  const results = await Promise.allSettled(
    offerIds.map(offerId => state.put(pushedAtKey(env, accountId, offerId), now, { ttl: TTL_SECONDS }))
  )
  if (logger?.error) {
    for (const r of results) {
      if (r.status === 'rejected') logger.error(`syncState.recordPushes failed: ${r.reason?.message}`)
    }
  }
}

// A product is "stale" if Google's processed status was last computed
// *before* our last recorded push for this offerId — i.e. the caller already
// fixed and resubmitted, but Google hasn't reprocessed the new version yet.
// Fails open (false) on any missing/unparseable data, a State outage, or an
// offerId we never recorded a push for — in every one of those cases there's
// no basis for suspecting staleness, so callers should just trust Google's
// returned status as-is.
async function isStale (state, env, accountId, offerId, product) {
  if (!state) return false
  const lastUpdateDate = product?.productStatus?.lastUpdateDate
  if (!lastUpdateDate) return false
  const lastUpdateMs = new Date(lastUpdateDate).getTime()
  if (Number.isNaN(lastUpdateMs)) return false
  try {
    const entry = await state.get(pushedAtKey(env, accountId, offerId))
    if (!entry || entry.value == null) return false
    const pushedAt = Number(entry.value)
    if (!Number.isFinite(pushedAt)) return false
    return lastUpdateMs < pushedAt
  } catch (e) {
    return false
  }
}

module.exports = { initState, recordPushes, isStale, pushedAtKey, TTL_SECONDS }
