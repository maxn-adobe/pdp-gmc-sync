async function runPool (items, worker, concurrency = 15) {
  const results = new Array(items.length)
  let idx = 0
  async function next () {
    while (true) {
      const i = idx++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  const n = Math.min(Math.max(1, concurrency), Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, next))
  return results
}

module.exports = { runPool }
