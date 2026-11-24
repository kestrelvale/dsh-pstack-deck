// 环境自检的下一步只有一条：链头。
//
// 六项平铺时用户看到的是「红了三行」，不知道该先点哪个；按顺序扫成一条链，
// 只有链头能动手，后面的项明说被谁挡住。判据里故意不含任何业务知识——
// 哪项该排前面是调用方给的顺序，这里只回答「现在能点哪一个」。

export const CHAIN_STATES = ['done', 'current', 'fail', 'pending']

const actionsOf = (it) => (Array.isArray(it?.actions) ? it.actions : [])

/**
 * 把有序的环境项扫成一条链，返回 { head, items }；items 的顺序就是链。
 * @param {Array<{ id: string, label?: string, ok: boolean, actions?: object[] }>} items
 */
export function evaluateChain(items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return { head: null, items: [] }

  const headAt = list.findIndex((it) => it?.ok !== true)
  // 全绿：没有链头，也没有「没轮到的」，每一项都真的做完了
  if (headAt === -1) return { head: null, items: list.map((it) => ({ ...it, chain: 'done' })) }

  const head = list[headAt]
  // 链头能不能点，只看它有没有动作：这是「当前」和「卡死」的唯一区别
  const state = actionsOf(head).length ? 'current' : 'fail'
  return {
    head: head.id,
    items: list.map((it, i) => {
      if (i < headAt) return { ...it, chain: 'done' }
      if (i === headAt) return { ...it, chain: state }
      // 链头没解决之前，后面每一项都是同一个原因排的队
      return { ...it, chain: 'pending', blockedBy: head.id }
    }),
  }
}