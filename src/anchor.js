// 项目锚定：会话的 cwd 常常是项目里的子目录（src/、packages/web/），
// 看板要是跟着 cwd 走，同一个项目就会看见好几块互相看不见的板。
// 上溯规则跟宿主自己找项目根一致：先认 .pstack，再认 .git，都没有就用 cwd。

import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

/** 上溯的层数上限。防止在 / 上无限找，也防止越过家目录爬到别的项目去。 */
export const MAX_UP = 12

/** 从 cwd 往上找项目根。返回绝对路径，找不到就返回 cwd 本身。 */
export function projectRoot(cwd) {
  if (typeof cwd !== 'string' || !cwd) return cwd
  let dir = cwd
  for (let i = 0; i < MAX_UP; i += 1) {
    if (existsSync(join(dir, '.pstack')) || existsSync(join(dir, '.git'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return cwd
}

/** 项目名：根目录的目录名。 */
export function projectName(root) {
  return basename(String(root || '')) || String(root || '')
}

/** cwd 相对项目根的路径（用 / 分隔）；就在根上时是空串。 */
export function relFrom(root, cwd) {
  if (!root || !cwd || root === cwd) return ''
  const rel = relative(root, cwd)
  if (!rel || rel.startsWith('..')) return ''
  return rel.split(sep).join('/')
}
