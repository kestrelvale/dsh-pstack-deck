// dsh-pstack-deck · 落盘
//
// 一次写 = 一次事务（照抄竞品 issues-status.js:85 rewriteTicketText 的八步）：
// 排队 → 版本闸 → 读盘上原文 → 变换 → 没变就不写 → tmp+rename → 写后回读。
// 任一步失败，盘上一个字节都不变。人手上改过的东西因此不会被自动写抹掉：
// 变换的底稿是刚读到的盘上文本，不是调用方内存里那份旧对象。

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { failAs } from './errors.js'
import { withKeyLock } from './lock.js'

/** 一个文件的上限。超了让人拆，而不是悄悄写成一个读不动的大文件。 */
export const FILE_CAP = 60 * 1024

/** 修改时间（毫秒）。文件不在返回 null——「拿不到版本」和「没有这个文件」是两件事。 */
export async function mtimeOf(path) {
  const st = await stat(path).catch(() => null)
  return st ? Math.round(st.mtimeMs) : null
}

/** 同目录 tmp 再 rename：崩了最多剩个 tmp，不会剩半份文件。 */
export async function writeAtomic(path, text) {
  const tmp = join(dirname(path), `.${process.pid}.${Date.now().toString(36)}.tmp`)
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/** 乐观锁：盘上版本和你读到的不一样就拒写。新文件没有版本，跳过。 */
export async function assertUnchanged(path, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === null) return
  const at = await mtimeOf(path)
  if (at === null) {
    throw failAs('conflict', '这个文件不见了：你读到它之后被删掉了，所以这次一个字都没写', '刷新看板再试一次')
  }
  if (Math.abs(at - Number(expectedUpdatedAt)) > 2) {
    throw failAs(
      'conflict',
      '这个文件在你读到它之后已经被改过，所以这次一个字都没写',
      '刷新看板，看清盘上现在是什么样再改',
    )
  }
}

const tooBig = (cap) =>
  failAs(
    'conflict',
    `超过 ${Math.round(cap / 1024)}KB 上限：一个文件塞不下这么多`,
    '把细节拆到子卡里，卡上只留「要做什么」和「验过没有」',
  )

const notSame = () =>
  failAs('conflict', '写后回读和刚写进去的不一致：盘上被别的东西动过', '刷新看板，确认盘上现在是什么样再改')

/**
 * 改一个已存在的文件。apply 拿到盘上原文，交回整篇新文本。
 * 返回 {written, reason, text}；reason 是 noop（没变）或 edited（真写了）。
 * expectedUpdatedAt 给了就做乐观锁：和盘上 mtime 对不上，一个字都不写。
 */
export async function rewriteText(path, apply, { expectedUpdatedAt, cap = FILE_CAP } = {}) {
  return withKeyLock(path, async () => {
    let before = null
    try {
      before = await readFile(path, 'utf8')
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e
    }
    await assertUnchanged(path, expectedUpdatedAt)
    const text = await apply(before)
    if (typeof text !== 'string') throw failAs('parse', '改写没有交回文本：apply 必须返回整篇内容', '')
    if (Buffer.byteLength(text, 'utf8') > cap) throw tooBig(cap)
    if (before === text) return { written: false, reason: 'noop', text: before ?? '' }
    await writeAtomic(path, text)
    const after = await readFile(path, 'utf8')
    if (after !== text) throw notSame()
    return { written: true, reason: 'edited', text: after }
  })
}

/** 新建：同样原子落盘 + 回读；已经存在就报 conflict，不悄悄覆盖。 */
export async function writeNew(path, text, { cap = FILE_CAP } = {}) {
  return withKeyLock(path, async () => {
    if (Buffer.byteLength(text, 'utf8') > cap) throw tooBig(cap)
    if ((await mtimeOf(path)) !== null) {
      throw failAs('conflict', `${path} 已经存在：新建会盖掉别人，所以没写`, '换一个编号，或先读盘上那份')
    }
    await writeAtomic(path, text)
    const after = await readFile(path, 'utf8')
    if (after !== text) throw notSame()
    return { written: true, reason: 'fresh', text: after }
  })
}