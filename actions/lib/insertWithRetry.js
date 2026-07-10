const { parseGoogleError } = require('./googleError')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const jitter = (min, max) => Math.floor(min + Math.random() * (max - min))

async function insertWithRetry (client, req, offerId, logger) {
  try {
    const [resp] = await client.insertProductInput(req)
    return { offerId, ok: true, name: resp.name }
  } catch (err) {
    const p = parseGoogleError(err)
    if (p.retriable) {
      await sleep(jitter(500, 1500))
      try {
        const [resp] = await client.insertProductInput(req)
        return { offerId, ok: true, name: resp.name, retried: true }
      } catch (err2) {
        const p2 = parseGoogleError(err2)
        if (logger?.error) {
          logger.error(`insert failed offerId=${offerId} code=${p2.code} status=${p2.status} reason=${p2.reason}`)
        }
        return { offerId, ok: false, code: p2.code, status: p2.status, reason: p2.reason, message: p2.message, retried: true }
      }
    }
    if (logger?.error) {
      logger.error(`insert failed offerId=${offerId} code=${p.code} status=${p.status} reason=${p.reason}`)
    }
    return { offerId, ok: false, code: p.code, status: p.status, reason: p.reason, message: p.message }
  }
}

module.exports = { insertWithRetry }
