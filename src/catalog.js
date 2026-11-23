// dsh-pstack-deck · 目录层
//
// 唯一真相是磁盘上的 pstack 仓库（repo/skills/*/SKILL.md + repo/README.md）。
// provider、HTTP 路由、agent 工具、面板四处都从这里取数据，谁都不另存一份清单。
// 面板里的中文一句话在 src/i18n.js，不在本文件：它是给人看的措辞，不属于目录事实。

import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROVIDER = 'bundled-pstack'
export const RANK = 360

/** 包根目录。skills/ 与 repo/ 都在它下面。 */
export const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** pstack 仓库根：skills/ + README.md + plugin.json 都在这里。 */
export function repoRoot() {
  return join(PKG_ROOT, 'repo')
}

/** 中文正文放在 repo 外面：上游是只读镜像，pull 时不该有冲突。 */
export function zhRoot() {
  return join(PKG_ROOT, 'zh')
}

// ---------------------------------------------------------------- frontmatter

/**
 * 解析 SKILL.md 的 frontmatter。pstack 的字段全是标量（name / description /
 * disable-model-invocation / icon / color / argument-hint），所以手写行解析就够，
 * 不为六行 YAML 拉一个依赖进来。
 */
export function parseFrontmatter(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { data: {}, body: raw }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    data[kv[1]] = unquote(kv[2])
  }
  return { data, body: raw.slice(m[0].length) }
}

function unquote(v) {
  const s = String(v ?? '').trim()
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
  return s
}

/**
 * 一个技能目录 → provider 条目。name 必须等于目录名，否则宿主侧对不上
 * （dsh-skill-filesystem 的 discoverRoot 也这么校验）。
 */
export function parseSkill(text, dirName) {
  const { data, body } = parseFrontmatter(text)
  if (!data.name || data.name !== dirName) return null
  return {
    name: data.name,
    description: data.description ?? '',
    argumentHint: data['argument-hint'] ?? '',
    modelInvocable: String(data['disable-model-invocation'] ?? '').toLowerCase() !== 'true',
    icon: data.icon ?? '',
    color: data.color ?? '',
    body,
  }
}

// ---------------------------------------------------------------- README

/** README 里三张表：原则表（名字/分组/一句话）、依赖表、技能用法表。 */
export function parseReadme(markdown) {
  const out = { principles: {}, deps: {}, useWhen: {}, standalone: [] }
  const lines = String(markdown ?? '').split(/\r?\n/)

  for (const line of lines) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2) continue

    // 指向 skills/<name>/SKILL.md 的行：名字取路径（链接文字可能是短名，原则表就是
    // `[laziness-protocol](./skills/principle-laziness-protocol/SKILL.md)`）。
    const viaPath = line.match(/\(\.?\/?skills\/([a-z0-9-]+)\/SKILL\.md\)/)
    if (viaPath) {
      const name = viaPath[1]
      if (cells.length >= 3) {
        out.principles[name] = { group: cells[1], rule: stripMd(cells[2]) }
      } else {
        out.useWhen[name] = stripMd(cells[1])
      }
      continue
    }

    // 依赖表：| `teach` | `how`, `why` |
    const from = cells[0].match(/^`([a-z0-9-]+)`$/)
    if (from && cells[1] !== undefined) {
      const names = [...cells[1].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1])
      out.deps[from[1]] = names
    }
  }

  const solo = markdown.match(/so each one works alone:\s*\r?\n\s*\r?\n([^\n]+)/)
  if (solo) {
    for (const m of solo[1].matchAll(/`([a-z0-9-]+)`/g)) out.standalone.push(m[1])
  }
  return out
}

function stripMd(s) {
  return String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').trim()
}

/**
 * 依赖表里有两行是自然语言（"all `principle-*` skills"、"the skills you want
 * help with"），正则抽不出来，单独展开成确定的名字集合。这是 README 的写法，
 * 不是我猜的语义；写死这两条比伪造一个通用解析器诚实。
 */
export function expandDeps(name, deps) {
  if (name === 'poteto-help') return [] // 「the skills you want help with」不是依赖
  return deps ?? []
}

// ---------------------------------------------------------------- 目录

export async function listSkills(root = repoRoot()) {
  const skillsRoot = join(root, 'skills')
  let dirs = []
  try {
    dirs = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .sort()
  } catch {
    return { skills: [], readme: null, version: '' }
  }

  const skills = []
  for (const dir of dirs) {
    let text = ''
    try {
      text = await readFile(join(skillsRoot, dir, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const skill = parseSkill(text, dir)
    if (skill) skills.push({ ...skill, dir: join(skillsRoot, dir) })
  }

  let readme = null
  try {
    readme = await readFile(join(root, 'README.md'), 'utf8')
  } catch {
    readme = null
  }

  let version = ''
  try {
    version = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')).version ?? ''
  } catch {
    version = ''
  }

  return { skills, readme, version }
}

/**
 * 面板与工具共用的一份目录：技能 + 分组 + 依赖 + 缺什么 + 副本漂移。
 * installedRoot 是 ~/.dsh/skills；DSH 的 `/` 菜单读的是它，所以两边不一致
 * 意味着「面板说能用、实际跑的是旧版」。
 */
export async function buildCatalog({ root = repoRoot(), installedRoot = null } = {}) {
  const { skills, readme, version } = await listSkills(root)
  const parsed = readme ? parseReadme(readme) : { principles: {}, deps: {}, useWhen: {}, standalone: [] }
  const names = skills.map((s) => s.name)
  const present = new Set(names)

  const groups = {}
  for (const skill of skills) {
    const p = parsed.principles[skill.name]
    const group = p?.group ?? (skill.name.startsWith('principle-') ? 'core' : 'workflow')
    ;(groups[group] ??= []).push(skill.name)
  }

  const deps = {}
  for (const name of names) {
    const raw = parsed.deps[name]
    // 「all `principle-*` skills and most of the other skills」：原则全量 + 能独立跑的那批。
    const expanded = name === 'poteto-mode'
      ? names.filter((n) => n.startsWith('principle-') || parsed.standalone.includes(n))
      : expandDeps(name, raw)
    if (expanded.length) deps[name] = expanded
  }

  const missingDeps = {}
  for (const [name, need] of Object.entries(deps)) {
    const missing = need.filter((n) => !present.has(n))
    if (missing.length) missingDeps[name] = missing
  }

  const drift = installedRoot ? await diffInstalled({ root, installedRoot, names }) : { missing: [], changed: [], ok: true }

  return {
    version,
    root,
    installedRoot,
    skills: skills.map(({ body, ...rest }) => ({ ...rest, deps: deps[rest.name] ?? [], principle: parsed.principles[rest.name] ?? null })),
    groups,
    deps,
    missingDeps,
    drift,
    driftOk: drift.ok,
  }
}

/** 副本与仓库的差异。只比 SKILL.md 与同目录下的正文文件，不比 mtime。 */
export async function diffInstalled({ root = repoRoot(), installedRoot, names }) {
  const out = { missing: [], changed: [], ok: false }
  for (const name of names) {
    const a = await readTree(join(root, 'skills', name))
    const b = await readTree(join(installedRoot, name))
    if (b === null) {
      out.missing.push(name)
      continue
    }
    if (a.hash !== b.hash) out.changed.push(name)
  }
  out.ok = out.missing.length === 0 && out.changed.length === 0
  return out
}

async function readTree(dir) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const sub = await readTree(p)
      if (sub) files.push(...sub.files.map((f) => [e.name + '/' + f[0], f[1]]))
    } else if (e.isFile()) {
      try {
        files.push([e.name, createHash('sha256').update(await readFile(p)).digest('hex')])
      } catch {
        /* 读不到就当不存在 */
      }
    }
  }
  files.sort()
  const hash = createHash('sha256').update(files.map((f) => f.join(':')).join('|')).digest('hex')
  return { hash, files }
}

/** provider 条目：宿主 list() 要的形状。 */
export function toProviderItem(skill) {
  return {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: skill.modelInvocable, userInvocable: true },
    source: 'bundled',
    provider: PROVIDER,
    rank: RANK,
    locator: { path: join(skill.dir, 'SKILL.md'), directory: skill.dir },
    resourceBase: { kind: 'directory', path: skill.dir },
    path: join(skill.dir, 'SKILL.md'),
  }
}
