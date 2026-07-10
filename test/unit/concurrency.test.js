const { runPool } = require('../../actions/lib/concurrency')

describe('runPool', () => {
  test('processes every item and preserves order', async () => {
    const items = [1, 2, 3, 4, 5]
    const out = await runPool(items, async (n) => n * 2, 2)
    expect(out).toEqual([2, 4, 6, 8, 10])
  })

  test('bounds concurrency', async () => {
    let live = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    await runPool(items, async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
    }, 4)
    expect(peak).toBeLessThanOrEqual(4)
  })

  test('empty input returns empty array', async () => {
    const out = await runPool([], async () => 1, 10)
    expect(out).toEqual([])
  })

  test('worker error propagates', async () => {
    await expect(runPool([1], async () => { throw new Error('boom') }, 1)).rejects.toThrow('boom')
  })
})
