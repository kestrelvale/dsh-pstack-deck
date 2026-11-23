#!/usr/bin/env node
// pstack 仓库 → ~/.dsh/skills 单向同步。
//
// 为什么需要它：DSH 的 `/` 菜单读的是 ~/.dsh/skills 里的副本，而面板和工具读的是
// repo/skills 里的源。两边不一致时，面板说「有」，实际跑起来的是旧版。
//
// 用法：
//   node scripts/sync-skills.mjs            同步，并列出改了什么
//   node scripts/sync-skills.mjs --dry      只看差异，不动文件
//   node scripts/sync-skills.mjs --remove   顺带删掉 ~/.dsh/skills 里仓库已不存在的技能
//
// 只碰仓库里出现过的技能名。~/.dsh/skills 里别的技能（手工装的、别的插件的）不碰。

import { cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { buildCatalog, repoRoot } from '../src/catalog.js'

const args = new Set(process.argv.slice(2))
const dry = args.has('--dry')
const remove = args.has('--remove')

const root = repoRoot()
const dest = join(homedir(), '.dsh', 'skills')

const cat = await buildCatalog({ root })
const names = cat.skills.map((s) => s.name)

await stat(dest).catch(async () => {
  throw new Error(`目标目录不存在：${dest}（DSH 至少用过一次才会建出来）`)
})

let copied = 0
let same = 0
let deleted = 0

for (const name of names) {
  const from = join(root, 'skills', name)
  const to = join(dest, name)
  const a = await treeHash(from)
  const b = await treeHash(to)
  if (a && b && a === b) {
    same += 1
    continue
  }
  console.log(`${b ? '更新' : '新增'} ${name}`)
  copied += 1
  if (!dry) {
    await rm(to, { recursive: true, force: true })
    await cp(from, to, { recursive: true, preserveTimestamps: true })
  }
}

if (remove) {
  const here = new Set(names)
  const there = await readdir(dest, { withFileTypes: true })
  for (const e of there) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue
    if (here.has(e.name)) continue
    // 只删「曾经是 pstack 技能」的目录：有 SKILL.md 且 frontmatter 里能认出 pstack 味道的
    const p = join(dest, e.name, 'SKILL.md')
    const text = await readFile(p, 'utf8').catch(() => '')
    if (!text) continue
    console.log(`删除 ${e.name}（仓库里已没有）`)
    deleted += 1
    if (!dry) await rm(join(dest, e.name), { recursive: true, force: true })
  }
}

const tail = dry ? '（--dry，没有真的写盘）' : ''
console.log(`\n${names.length} 个技能：${same} 个一致，${copied} 个待写/已写，${deleted} 个删除${tail}`)

async function treeHash(dir) {
  const files = await walk(dir)
  if (files === null) return null
  return createHash('sha256').update(files.join('|')).digest('hex')
}

async function walk(dir, prefix = '') {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const out = []
  for (const e of entries) {
    const p = join(dir, e.name)
    const rel = prefix ? prefix + '/' + e.name : e.name
    if (e.isDirectory()) {
      const sub = await walk(p, rel)
      if (sub) out.push(...sub)
    } else if (e.isFile()) {
      out.push(rel + ':' + createHash('sha256').update(await readFile(p)).digest('hex'))
    }
  }
  return out.sort()
}
