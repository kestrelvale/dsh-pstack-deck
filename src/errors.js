// dsh-pstack-deck · 失败怎么说
//
// 失败不是异常，是一条有分类、有人话、有下一步的记录：面板按 kind 上色，
// 人照着 hint 动手。竞品把这个词表放在依赖扇出的最底层（vocabulary.js:38），
// 我们也一样——报错的话术属于基础设施，不属于某一次调用。

export const ERROR_KIND = [
  'conflict', // 盘上已经变了，这次不写
  'not-found', // 要找的东西不在
  'parse', // 盘上那份读不懂
  'unsupported', // 这件事这个形态做不了
  'permission', // 沙箱不让写
  'auth', // 要凭据：git 要用户名/令牌
  'network', // 网不通、DNS、超时
  'env', // 环境缺东西
  'unknown',
]

/** 造一个能跨边界传的失败：kind 决定怎么显示，hint 说下一步。 */
export function failAs(kind, message, hint = '') {
  const e = new Error(message)
  e.kind = ERROR_KIND.includes(kind) ? kind : 'unknown'
  if (hint) e.hint = hint
  return e
}

/** 过 rpc / 工具边界时统一成这个形状；别的字段不往下传。 */
export function errorOf(e) {
  return {
    kind: ERROR_KIND.includes(e?.kind) ? e.kind : 'unknown',
    message: String(e?.message ?? e),
    hint: String(e?.hint ?? ''),
  }
}