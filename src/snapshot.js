// dsh-pstack-deck · 快照层
//
// 面板一次打开会连发两三条读（看板 + 剧本 + 环境），每条都重扫盘就是三倍 I/O；
// 反过来，缓存只要不失效，人手改的文件就永远看不见。所以这里只有三条规矩：
//
// 1. 同一个 key 的读合并成一次（单飞）——并发请求等同一个 promise，不各扫一遍；
// 2. 5 秒内直接给上次的值，过了就重读；
// 3. 重读失败**不抛掉旧值**：手里有上次的好值就继续给，但把「这次没读到」
//    如实写进 freshness/error（面板会画成「显示的是 3 分钟前的值 · 刷新失败」）。
//    这份诚实是第 1 条的前提：缓存可以说旧，但不能假装新。

import { SNAPSHOT_TTL_MS } from './constants.js'
import { errorOf } from './errors.js'

/** freshness 三态：fresh 刚读到 / stale 超期了但手里有旧值 / failed 这次没读到。 */
export const FRESHNESS = ['fresh', 'stale', 'failed']

export function createSnapshots({ ttlMs = SNAPSHOT_TTL_MS, now = Date.now } = {}) {
  /** key → { at, value }：只存最后一次读成功的结果。 */
  const good = new Map()
  /** key → promise：正在读的合并点。 */
  const doing = new Map()

  function hit(key, t) {
    const e = good.get(key)
    if (!e) return undefined
    const ageMs = Math.max(0, t - e.at)
    return { value: e.value, at: e.at, ageMs, stale: ageMs >= ttlMs, freshness: ageMs >= ttlMs ? 'stale' : 'fresh' }
  }

  async function load(key, fn) {
    try {
      const value = await fn()
      const at = now()
      good.set(key, { at, value })
      return { value, at, ageMs: 0, stale: false, freshness: 'fresh', source: 'load' }
    } catch (e) {
      // 失败不进缓存；有旧值就继续服务旧值，并把失败原因带出去
      const old = good.get(key)
      if (!old) throw e
      const at = Math.max(0, now() - old.at)
      return { value: old.value, at: old.at, ageMs: at, stale: true, freshness: 'failed', source: 'load', error: errorOf(e) }
    }
  }

  return {
    /**
     * @param {string} key
     * @param {() => any} fn 真去读的函数（可以是 async）
     * @param {{force?: boolean}} [opts] force = 面板点了刷新，绕开 TTL
     */
    async get(key, fn, opts = {}) {
      const t = now()
      const cached = hit(key, t)
      if (!opts.force && cached && !cached.stale) return { ...cached, source: 'cache' }
      const flying = doing.get(key)
      if (flying) {
        const r = await flying
        // 等别人读完了：它就是最新的，不必再读一次
        return { ...r, source: 'wait' }
      }
      const p = load(key, fn)
      doing.set(key, p)
      try {
        return await p
      } finally {
        if (doing.get(key) === p) doing.delete(key)
      }
    },
    /** 写过就作废：下一次读必须碰盘。 */
    del(key) {
      good.delete(key)
      return true
    },
    clear() {
      good.clear()
      doing.clear()
    },
    size() {
      return good.size
    },
  }
}