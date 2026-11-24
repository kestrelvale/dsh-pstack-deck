// 剧本（playbook）：pstack 里「技能之间没有硬顺序」——顺序在剧本里。
// 22 套剧本，每套是一串编号步骤，步骤正文里点名这一步要用哪些技能。
// 这里只做一件事：把那些步骤解析成数据（第几步、这一步点名的技能），
// 让面板能回答「这套剧本走到第 2 步，下一步该用哪个技能」。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { repoRoot } from './catalog.js'

export const PLAYBOOK_REL = join('skills', 'poteto-mode', 'playbooks')

export function playbookRoot() {
  return join(repoRoot(), PLAYBOOK_REL)
}

// 「Opening a PR」这种人类写法对应 opening-a-pr 这个技能名
export const titleToSlug = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// 步骤里点名的技能只认两种写法：**name** 与 `name`。普通词里出现的名字不算，
// 否则「test」之类的词会把所有步骤都连到 tdd 上。
function skillsIn(text, known) {
  const out = []
  const push = (raw) => {
    const slug = titleToSlug(raw)
    if (known.has(slug) && !out.includes(slug)) out.push(slug)
  }
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) push(m[1].trim())
  for (const m of text.matchAll(/`([^`\n]{2,60})`/g)) push(m[1].trim())
  // 技能名直接出现在句子里（next step uses architect）也算，但只在整词边界上
  for (const name of known) {
    if (out.includes(name)) continue
    if (new RegExp(`(^|[^a-z0-9-])${name}([^a-z0-9-]|$)`, 'i').test(text)) out.push(name)
  }
  return out
}

export function parsePlaybook(raw, known) {
  const titleLine = raw.match(/^###\s+(.+)$/m)
  const title = titleLine ? titleLine[1].trim() : ''
  const steps = []
  const lines = raw.split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s+(.*)$/)
    if (m) {
      if (cur) steps.push(cur)
      cur = { n: Number(m[1]), text: m[2].trim() }
      continue
    }
    // 编号步骤后面跟着的续行并进上一步；空行结束当前步骤
    if (cur && line.trim() && !/^#/.test(line) && !/^\*\*Reply/.test(line)) {
      cur.text += ' ' + line.trim()
    } else if (cur && !line.trim()) {
      steps.push(cur)
      cur = null
    }
  }
  if (cur) steps.push(cur)
  // 步骤正文只用来显示与给 agent 读：去掉 markdown 强调符号，只留纯文字
  const plain = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
  const named = steps.map((s) => ({ n: s.n, text: plain(s.text), skills: skillsIn(s.text, known) }))
  return {
    title,
    steps: named,
    skills: [...new Set(named.flatMap((s) => s.skills))],
    // 这套剧本第一步要用哪个技能：看板拿它当「还没起头」时的下一步
    firstSkill: (named.find((s) => s.skills.length) || {}).skills?.[0] || '',
  }
}

/** 列出仓库里的全部剧本；名字按文件名（bug-fix），标题取 `### Bug fix` */
export async function listPlaybooks(known) {
  const knownSet = known instanceof Set ? known : new Set(known)
  let files = []
  try {
    files = (await readdir(playbookRoot())).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
  const out = []
  for (const file of files) {
    try {
      const raw = await readFile(join(playbookRoot(), file), 'utf8')
      const parsed = parsePlaybook(raw, knownSet)
      out.push({ slug: file.replace(/\.md$/, ''), ...parsed })
    } catch {
      /* 一个读不了不该让整张列表塌掉 */
    }
  }
  return out
}

/** 按名字取一套剧本（看板在 view() 里用） */
export async function playbookByName(slug, known) {
  const name = String(slug || '').trim()
  if (!/^[a-z0-9-]{1,64}$/.test(name)) return null
  try {
    const raw = await readFile(join(playbookRoot(), name + '.md'), 'utf8')
    return { slug: name, ...parsePlaybook(raw, known instanceof Set ? known : new Set(known)) }
  } catch {
    return null
  }
}

/** 某张卡在剧本里走到哪一步：给下一步的技能候选 */
export function stepOf(play, step) {
  if (!play || !Array.isArray(play.steps) || !play.steps.length) return null
  const n = Number(step) || 1
  return play.steps.find((s) => s.n === n) || null
}
