// 环境自检：面板第四个页签。
//
// 竞品 dsh-mattpocock-skills-deck 的 INIT FLOW 第 6 步就是「环境检测-列表」，每项带状态、带刷新。
// 这里做同一件事，但只查这个插件真的依赖的东西——技能读不读得到、中文正文全不全、依赖缺不缺、
// 装出去的副本是不是旧的、当前项目的板初始化没有、插件版本是不是旧的。
//
// 每一条都必须附一句「怎么补」。用户问的从来不是「红了几项」，而是「我怎么才能让它恢复正常」，
// 所以 hint 写成能直接照着做的一句话，而不是报错原文。

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { projectName, projectRoot } from './anchor.js'
import { buildCatalog, repoRoot, zhRoot } from './catalog.js'
import { detectInit } from './init.js'
import { checkUpdate } from './update.js'

/** 一行的状态。skip 是「这条查不了，也不算病」，不能拿 fail 冒充。 */
export const ENV_STATES = ['ok', 'warn', 'fail', 'skip']

const row = (key, label, state, detail, hint = '') => ({ key, label, state, detail, hint })

/** 中文正文有几份。没有 zh/ 目录不是错：插件本来就能只显原文。 */
async function zhCount(names) {
  const dir = zhRoot()
  if (!existsSync(dir)) return null
  try {
    const files = await readdir(dir)
    const known = new Set(names)
    return files.filter((f) => f.endsWith('.md') && known.has(f.slice(0, -3))).length
  } catch {
    return null
  }
}

/**
 * 跑一遍自检。`fresh` 只影响版本这一条：其余都是读磁盘，本来就没有缓存。
 * 返回 rows 而不是「有没有问题」——面板要逐条画，还要能指着每一条说怎么修。
 */
export async function checkEnv({ cwd = process.cwd(), fresh = true, updater = checkUpdate } = {}) {
  const root = repoRoot()
  const installedRoot = join(homedir(), '.dsh', 'skills')
  const cat = await buildCatalog({ root, installedRoot })
  const names = cat.skills.map((s) => s.name)
  const rows = []

  // 1 · 技能目录：读不到就等于面板空着，这是唯一值得算 fail 的一条
  rows.push(
    names.length
      ? row('skills', '技能目录', 'ok', `${names.length} 个技能，读自 ${join(root, 'skills')}`)
      : row('skills', '技能目录', 'fail', '一个技能都没读到', '装的包里缺 skills/：重装 dsh-pstack-deck'),
  )

  // 2 · 中文正文：缺了只影响读起来顺不顺，不影响能不能用
  const zh = await zhCount(names)
  if (zh === null) rows.push(row('zh', '中文正文', 'skip', '没有 zh/ 目录，面板显示原文'))
  else if (zh === 0) rows.push(row('zh', '中文正文', 'warn', `0 / ${names.length} 份`, '运行 node scripts/check-zh.mjs 看缺哪几个'))
  else if (zh < names.length) rows.push(row('zh', '中文正文', 'warn', `${zh} / ${names.length} 份`, `还差 ${names.length - zh} 份：node scripts/check-zh.mjs 列出来`))
  else rows.push(row('zh', '中文正文', 'ok', `${zh} / ${names.length} 份`))

  // 3 · 依赖技能：SKILL.md 里点了名却不在仓库里的，点开详情会显示缺
  const missing = Object.entries(cat.missingDeps)
  rows.push(
    missing.length
      ? row('deps', '依赖技能', 'warn', missing.map(([n, m]) => `${n} 缺 ${m.join('、')}`).join('；'), '上游少给了技能，或者是名字拼错：照 README 的清单核一遍')
      : row('deps', '依赖技能', 'ok', `${Object.keys(cat.deps).length} 条依赖都齐`),
  )

  // 4 · ~/.dsh/skills 副本：插件自己注册技能，不装副本也能用，所以「没装」是 skip 不是 fail
  if (!existsSync(installedRoot)) {
    rows.push(row('installed', '安装副本', 'skip', '没装到 ~/.dsh/skills', '不需要：技能由插件注册，/ 菜单照样能列出来'))
  } else {
    const d = cat.drift
    const bad = (d.missing?.length ?? 0) + (d.changed?.length ?? 0)
    rows.push(
      bad
        ? row('installed', '安装副本', 'warn', `缺 ${d.missing?.length ?? 0} 个、旧 ${d.changed?.length ?? 0} 个`, '照着仓库把 ~/.dsh/skills 重新拷一遍（或删掉它，改用插件注册的这份）')
        : row('installed', '安装副本', 'ok', `${names.length} 个和仓库一致`),
    )
  }

  // 5 · 当前项目：板没起，看板和剧本都空着，这一步是「点一下就好」
  const proj = projectRoot(cwd)
  const init = await detectInit(proj)
  const MISSING_ZH = { board: '没有看板', map: '没有地图卡', readme: '没有 .pstack/README.md', agents: 'AGENTS.md 没有「## 项目看板」段' }
  rows.push(
    init.initialized
      ? row('board', '当前项目', 'ok', `${projectName(proj)} · ${init.cards} 张卡`)
      : row('board', '当前项目', 'warn', init.missing.map((m) => MISSING_ZH[m] ?? m).join('、'), '在面板「看板」页点初始化，一次补齐这四样'),
  )

  // 6 · 版本：连不上 npm 不算问题，标 skip 就好，别把断网说成插件有病
  let upd = null
  try {
    upd = await updater({ current: cat.version, useCache: !fresh })
  } catch (e) {
    rows.push(row('version', '插件版本', 'skip', `v${cat.version}，没连上 npm`, String(e?.message ?? e)))
  }
  if (upd) {
    rows.push(
      upd.error
        ? row('version', '插件版本', 'skip', `v${cat.version}，查不到新版`, String(upd.error))
        : upd.hasUpdate
          ? row('version', '插件版本', 'warn', `v${cat.version} → v${upd.latest}`, '在 DSH 插件市场里升级，然后重启 dsh web')
          : row('version', '插件版本', 'ok', `v${cat.version}，已是最新`),
    )
  }

  const summary = { ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const r of rows) summary[r.state] += 1
  return {
    at: Date.now(),
    root,
    cwd: proj,
    project: { name: projectName(proj), initialized: init.initialized, cards: init.cards },
    health: summary.fail ? 'fail' : summary.warn ? 'warn' : 'ok',
    rows,
    summary,
  }
}