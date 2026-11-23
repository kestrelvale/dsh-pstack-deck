// 校验 zh/ 下的中文正文：58 个技能是否都翻了，代码块是否一字未改，标题是否一一对应。
// 用法：node scripts/check-zh.mjs        （缺文件/代码块被改 → 退出码 1）
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot, zhRoot } from '../src/catalog.js'

const strip = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, '') // 去掉 frontmatter
// 代码块里的整行注释允许译成中文（读者看得懂才有用），所以比对时把注释行去掉，只钉代码本身。
const fences = (md) => [...md.matchAll(/^```[^\n]*\n[\s\S]*?^```$/gm)]
  .map((m) => m[0].split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n'))
const heads = (md) => [...md.matchAll(/^#{1,6} .+$/gm)].map((m) => m[0])

const names = await readdir(join(repoRoot(), 'skills'))
const missing = []
const bad = []
for (const n of names.sort()) {
  const src = strip(await readFile(join(repoRoot(), 'skills', n, 'SKILL.md'), 'utf8'))
  let zh
  try {
    zh = await readFile(join(zhRoot(), n + '.md'), 'utf8')
  } catch {
    missing.push(n)
    continue
  }
  const a = fences(src)
  const b = fences(zh)
  if (a.length !== b.length) bad.push(`${n}: 代码块 ${a.length} → ${b.length}`)
  else for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bad.push(`${n}: 第 ${i + 1} 个代码块被改`)
  if (heads(src).length !== heads(zh).length) bad.push(`${n}: 标题 ${heads(src).length} → ${heads(zh).length}`)
}

console.log(`${names.length} 个技能，已翻 ${names.length - missing.length}，缺 ${missing.length}`)
if (missing.length) console.log('缺：' + missing.join(' '))
if (bad.length) console.log('有问题：\n  ' + bad.join('\n  '))
process.exit(missing.length || bad.length ? 1 : 0)
