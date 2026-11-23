// 版本检查：面板上「是不是落后了」这个问题，答案只可能是「去 npm 看一眼」。
//
// 不引 semver 依赖——比版本号这件事按 x.y.z 数字比就够了，
// 预发布标记（0.2.0-beta.1）按「比同号正式版旧」处理。

const REGISTRY = 'https://registry.npmjs.org'
const TTL = 10 * 60 * 1000 // 十分钟内不重复打 npm，免得每次开面板都发请求

// 缓存只存「npm 上最新版是多少」，不存结论——结论取决于调用方传进来的 current，
// 而 current 会随升级变化，缓存结论会在升级后撒谎。
let cache = { at: 0, latest: '', error: '' }

/** 把 "0.1.0" / "0.2.0-beta.3" 拆成 [0,1,0] + 预发布标记 */
export function parseVersion(v) {
  const m = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { num: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' }
}

/** a 比 b 新返回 true；解析不了就一律 false（宁可漏报，不误报） */
export function newer(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i += 1) {
    if (x.num[i] !== y.num[i]) return x.num[i] > y.num[i]
  }
  if (x.pre === y.pre) return false
  if (!x.pre) return true // 正式版比预发布新
  if (!y.pre) return false
  return x.pre > y.pre
}

/**
 * 问一次 npm：这个包最新版是多少。
 * fetcher 可注入，测试里不用真联网。
 */
export async function checkUpdate({ current, fetcher = fetch, now = Date.now(), useCache = true } = {}) {
  const base = { current, latest: '', hasUpdate: false, cached: false, error: '' }
  const age = now - cache.at
  if (useCache && cache.at && age >= 0 && age < TTL) { // age<0 = 时钟回拨，别信缓存
    return { ...base, latest: cache.latest, error: cache.error, hasUpdate: newer(cache.latest, current), cached: true }
  }
  try {
    const res = await fetcher(`${REGISTRY}/dsh-pstack-deck`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (!res || !res.ok) throw new Error(`registry ${res ? res.status : 'no response'}`)
    const meta = await res.json()
    const latest = meta?.['dist-tags']?.latest || ''
    cache = { at: now, latest, error: '' }
    return { ...base, latest, hasUpdate: newer(latest, current) }
  } catch (e) {
    // 离线、被墙、registry 抽风：说清楚没查到，不要装作是最新
    // 失败不写缓存：断网十秒后恢复，不该还拿着十秒前的失败结论
    return { ...base, error: String((e && e.message) || e) }
  }
}
