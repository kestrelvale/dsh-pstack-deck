// dsh-pstack-deck · 同一个东西别两个人同时改
//
// 进程内一张 Map，key 是路径。照抄竞品 tracker/rooms/markdown/write-queue.js:3
// 的形状：每个 key 一条 promise 链，前一个活失败也照样放行下一个——
// 一次写失败不该把整条队列毒死。

export const lockKey = (path) =>
  String(path ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '')

const chains = new Map()

/** 同一个 key 的活排队跑；返回值就是 work 的返回值。 */
export function withKeyLock(key, work) {
  const k = lockKey(key)
  const prev = chains.get(k) ?? Promise.resolve()
  const next = prev.then(work, work)
  const tail = next.then(
    () => {},
    () => {},
  )
  chains.set(k, tail)
  // 链尾跑完就把表里这条删掉：不然改过一万个文件就攒一万条死 promise
  tail.then(() => {
    if (chains.get(k) === tail) chains.delete(k)
  })
  return next
}