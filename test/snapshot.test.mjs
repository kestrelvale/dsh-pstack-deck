// 快照层的判据：缓存可以说旧，但不能假装新。这里钉死三条容易退化的行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSnapshots, FRESHNESS } from '../src/snapshot.js'
import { failAs } from '../src/errors.js'

function clock(start = 1_000) {
  let t = start
  return { now: () => t, tick: (ms) => { t += ms; return t } }
}

test('快照：5 秒内重复读只碰一次盘', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  let n = 0
  const load = async () => ({ n: ++n })
  const a = await snaps.get('k', load)
  c.tick(4000)
  const b = await snaps.get('k', load)
  assert.equal(n, 1)
  assert.equal(a.freshness, 'fresh')
  assert.equal(b.source, 'cache')
  assert.equal(b.ageMs, 4000)
})

test('快照：超过 TTL 就重读', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  let n = 0
  const load = async () => ({ n: ++n })
  await snaps.get('k', load)
  c.tick(5001)
  const r = await snaps.get('k', load)
  assert.equal(n, 2)
  assert.equal(r.value.n, 2)
  assert.equal(r.source, 'load')
})

test('快照：并发三条读合成一次，另外两条等它', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  let n = 0
  const load = async () => {
    n += 1
    await new Promise((r) => setTimeout(r, 10))
    return { n }
  }
  const [a, b, d] = await Promise.all([
    snaps.get('k', load),
    snaps.get('k', load),
    snaps.get('k', load),
  ])
  assert.equal(n, 1, '三份并发请求只能落一次盘')
  assert.equal(a.value.n, 1)
  assert.equal(b.value.n, 1)
  assert.equal(d.source === 'wait' || d.source === 'load', true)
})

test('快照：force 绕开 TTL，点了刷新就是真重读', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  let n = 0
  const load = async () => ({ n: ++n })
  await snaps.get('k', load)
  const r = await snaps.get('k', load, { force: true })
  assert.equal(n, 2)
  assert.equal(r.value.n, 2)
})

test('快照：没有旧值又读失败 → 原样抛，不编一个空值', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  await assert.rejects(
    () => snaps.get('k', async () => { throw failAs('parse', '看板读不出来', '看一眼 .pstack/board 里的文件') }),
    (e) => e.kind === 'parse',
  )
  assert.equal(snaps.size(), 0)
})

test('快照：有旧值但这次读失败 → 给旧值但标 failed，并把原因带出去', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  const first = await snaps.get('k', async () => ({ v: 1 }))
  assert.equal(first.freshness, 'fresh')
  c.tick(9000)
  const r = await snaps.get('k', async () => { throw failAs('env', 'git 不可用', '装 git') })
  assert.equal(r.value.v, 1, '旧值还得给，否则面板整块空白')
  assert.equal(r.freshness, 'failed')
  assert.equal(r.stale, true)
  assert.equal(r.error.kind, 'env')
  assert.equal(r.ageMs, 9000)
})

test('快照：del 之后下一次必须重读；三态常量齐全', async () => {
  const c = clock()
  const snaps = createSnapshots({ ttlMs: 5000, now: c.now })
  let n = 0
  const load = async () => ({ n: ++n })
  await snaps.get('k', load)
  snaps.del('k')
  const r = await snaps.get('k', load)
  assert.equal(n, 2)
  assert.equal(r.source, 'load')
  assert.deepEqual(FRESHNESS, ['fresh', 'stale', 'failed'])
})