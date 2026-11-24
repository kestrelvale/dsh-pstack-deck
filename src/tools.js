// dsh-pstack-deck · agent 侧工具
//
// 两个工具：先看有什么（pstack_list），再去用一个（pstack_use）。
// 为什么需要工具：58 个技能里有 57 个声明了 disable-model-invocation，模型不会
// 自动发现它们；`/` 菜单是给人用的，模型这边要一条能查能读的入口。

import { readFile, stat, mkdir, cp } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'

import {
  addProgress,
  blockersOf,
  conflictsOf,
  KINDS,
  claimCard,
  finishCard,
  kindZh,
  loadBoard,
  mapOf,
  nextOf,
  recommend,
  reopenCard,
  saveCard,
  stateZh,
  STATES,
} from './board.js'
import { projectRoot } from './anchor.js'
import { buildCatalog, repoRoot, zhRoot, RANK } from './catalog.js'
import { detectInit, initProject } from './init.js'
import { suggest } from './suggest.js'
import { listPlaybooks, playbookByName } from './playbook.js'
import { resolveWorkspace, workspaceOf } from './host.js'
import { zhOf } from './i18n.js'

export const name = 'dsh-pstack-deck/tools'
export const inject = ['tools']

const TIMEOUT = 20000

const text = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
}

async function catalog() {
  return buildCatalog({ root: repoRoot(), installedRoot: null })
}

async function list(args) {
  const cat = await catalog()
  const q = String(args?.query ?? '').trim().toLowerCase()
  const group = String(args?.group ?? '').trim()

  let rows = cat.skills
  if (group) rows = rows.filter((s) => (s.principle?.group ?? 'workflow') === group)
  if (q) {
    rows = rows.filter((s) =>
      s.name.includes(q) || zhOf(s).toLowerCase().includes(q) || String(s.description).toLowerCase().includes(q))
  }

  const lines = [`pstack ${cat.version} · ${cat.skills.length} 个技能${q || group ? `，筛出 ${rows.length}` : ''}`, '']
  for (const [g, names] of Object.entries(cat.groups)) {
    const hit = rows.filter((s) => names.includes(s.name))
    if (!hit.length) continue
    lines.push(`## ${g}（${hit.length}）`)
    for (const s of hit) {
      const dep = s.deps.length ? ` · 需 ${s.deps.filter((d) => cat.missingDeps[s.name]?.includes(d)).length ? '缺 ' : '同装 '}${(cat.missingDeps[s.name] ?? s.deps).length} 个` : ''
      lines.push(`- ${s.name} — ${zhOf(s)}${s.argumentHint ? `（参数：${s.argumentHint}）` : ''}${dep}`)
    }
    lines.push('')
  }
  if (Object.keys(cat.missingDeps).length) {
    lines.push('依赖缺人：' + Object.entries(cat.missingDeps).map(([k, v]) => `${k} 缺 ${v.join('/')}`).join('；'))
  }
  lines.push('用法：pstack_use { name, task } 拿到那个技能的完整说明，然后照着做。')
  return lines.join('\n')
}

async function use(args) {
  const n = String(args?.name ?? '').trim()
  if (!/^[a-z0-9-]{1,64}$/.test(n)) throw new Error('name 必须是技能名，例如 tdd')
  const cat = await catalog()
  const skill = cat.skills.find((s) => s.name === n)
  if (!skill) {
    const near = cat.skills.filter((s) => s.name.includes(n) || n.includes(s.name)).slice(0, 5).map((s) => s.name)
    throw new Error(`没有 ${n} 这个技能。${near.length ? '是不是：' + near.join(', ') : '先 pstack_list 看看有什么。'}`)
  }
  const body = await readFile(join(skill.dir, 'SKILL.md'), 'utf8')
  let zh = ''
  try {
    zh = await readFile(join(zhRoot(), n + '.md'), 'utf8')
  } catch {
    /* 没翻就用原文 */
  }
  const task = String(args?.task ?? '').trim()
  const head = [
    `你在执行 pstack 技能 ${n}（${zhOf(skill)}）。下面的规则就是这次任务的操作说明，按它做，别改写成别的流程。`,
    task ? `\n这次的任务：${task}` : '',
    skill.argumentHint ? `\n它接受的参数是：${skill.argumentHint}` : '',
    cat.missingDeps[n]?.length ? `\n注意：这个技能依赖的同装技能没齐——${cat.missingDeps[n].join('、')}。` : '',
    zh ? '\n--- 技能正文（中文）---\n' : '\n--- 技能正文 ---\n',
  ].join('')
  return head + (zh || body)
}

/**
 * 装到某个项目：宿主认 `<项目>/.dsh/skills/`（或 `.agents/skills/`）作为项目级技能目录，
 * 会话启动时扫描。面板在浏览器里拿不到项目路径，所以这条路走工具——agent 知道自己在哪。
 */
async function install(args) {
  const dir = String(args?.dir ?? '').trim()
  if (!isAbsolute(dir)) throw new Error('dir 要是项目的绝对路径，例如 /Users/me/proj')
  let st
  try {
    st = await stat(dir)
  } catch {
    throw new Error(`没有这个目录：${dir}`)
  }
  if (!st.isDirectory()) throw new Error(`${dir} 不是目录`)

  const cat = await catalog()
  const byName = new Map(cat.skills.map((s) => [s.name, s]))
  const asked = Array.isArray(args?.names) && args.names.length ? args.names.map(String) : [...byName.keys()]
  const bad = asked.filter((n) => !byName.has(n))
  if (bad.length) throw new Error(`没有这些技能：${bad.join(', ')}（先 pstack_list 看看）`)

  const want = new Set(asked)
  if (args?.withDeps !== false) {
    let grew = true
    while (grew) {
      grew = false
      for (const n of [...want]) {
        for (const d of byName.get(n)?.deps ?? []) {
          if (byName.has(d) && !want.has(d)) {
            want.add(d)
            grew = true
          }
        }
      }
    }
  }

  const target = join(dir, '.dsh', 'skills')
  await mkdir(target, { recursive: true })
  for (const n of want) await cp(join(repoRoot(), 'skills', n), join(target, n), { recursive: true, force: true })

  const pulled = [...want].filter((n) => !asked.includes(n))
  return [
    `已装 ${want.size} 个技能到 ${target}`,
    pulled.length ? `多装的 ${pulled.length} 个是同装依赖：${pulled.join('、')}` : '',
    '项目级技能在会话启动时扫描，新开一个会话或在那个项目里新建会话才看得到。',
  ].filter(Boolean).join('\n')
}

/**
 * 卡写进哪个项目。工具拿不到 exec.cwd——宿主的 exec 里只有 `agent`，
 * 会话工作目录在 `exec.agent.session.header.cwd`（这是宿主自己的形状，不是我们编的）。
 * 少了这一条，工具会把卡写进一个叫 unbound 的假项目，人点开面板只看到空板。
 */
function boardDir(args, exec, ctx) {
  const explicit = String(args?.dir ?? '').trim()
  if (explicit) return projectRoot(explicit)
  const header = exec?.agent?.session?.header
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  return workspaceOf(ctx, header?.id ?? exec?.sessionId, cwd || process.cwd())
}

/**
 * 看板。agent 得知道自己在哪个项目里，所以 dir 优先：不给就退回这个会话的工作目录。
 */
async function boardTool(args, exec, ctx) {
  const op = String(args?.op ?? 'list').trim()
  const dir = boardDir(args, exec, ctx)
  if (op === 'add') {
    const title = String(args?.title ?? '').trim()
    if (!title) throw new Error('写一句这张卡要干什么')
    const card = await saveCard(dir, {
      kind: KINDS.includes(args?.kind) ? args.kind : 'idea',
      state: STATES.includes(args?.state) ? args.state : undefined,
      title,
      body: String(args?.body ?? ''),
      skills: [recommend({ kind: args?.kind, state: 'idea', title, body: String(args?.body ?? '') })?.skill].filter(Boolean),
      // after：这张卡要等哪几张先做完（拓扑图里的箭头）
      after: Array.isArray(args?.after) ? args.after : undefined,
      parent: args?.parent ? Number(args.parent) : undefined,
      scope: Array.isArray(args?.scope) ? args.scope : undefined,
      owner: args?.owner !== undefined ? String(args.owner) : undefined,
      // 绑剧本：这张卡按哪套剧本的第几步走（拓扑里「下一步」就先看这一步点名了什么技能）
      playbook: args?.playbook !== undefined ? String(args.playbook) : undefined,
      step: args?.step !== undefined ? Number(args.step) : undefined,
    })
    return `已记入看板：#${card.id} ${card.title}（${kindZh(card.kind)} · ${stateZh(card.state)}）\n${dir}`
  }
  if (op === 'done' || op === 'drop') {
    const id = Number(args?.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('要给卡号 id')
    const card = await finishCard(dir, id, { state: op === 'done' ? 'done' : 'dropped', note: String(args?.note ?? '') })
    const map = mapOf((await loadBoard(dir)).cards)
    return [
      `#${card.id} ${card.title} → ${stateZh(card.state)}`,
      `结论已写进卡里${map ? `，也记到地图 #${map.id} 的「${op === 'done' ? '已经定了' : '不做什么'}」` : ''}。`,
      '下一张：op=list 看现在的可开工。',
    ].join('\n')
  }
  if (op === 'reopen') {
    const id = Number(args?.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('要给卡号 id')
    const card = await reopenCard(dir, id, { note: String(args?.note ?? '') })
    return `#${card.id} ${card.title} 已重开（${stateZh(card.state)}），可以再认领。`
  }
  if (op === 'move') {
    const id = Number(args?.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('要给卡号 id')
    const want = String(args?.state ?? '').trim()
    if (want === 'done' || want === 'dropped') {
      throw new Error(`结束要走 op=${want === 'done' ? 'done' : 'drop'} 并给一句 note——没有结论的「结束」等于没做`)
    }
    if (!STATES.includes(want)) throw new Error('move 要 state=todo 或 doing（结束用 done / drop）')
    const card = await addProgress(dir, id, String(args?.note ?? ''), want)
    return `#${card.id} ${card.title} → ${stateZh(card.state)}`
  }
  if (op === 'claim') {
    const id = Number(args?.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('要给卡号 id')
    const owner = String(args?.owner ?? exec?.sessionId ?? 'me').trim()
    const scope = Array.isArray(args?.scope) ? args.scope : []
    const card = await claimCard(dir, id, { owner, scope })
    const doing = (await loadBoard(dir)).cards.filter((c) => c.owner && c.owner === owner && c.state === 'doing' && c.id !== card.id)
    return [
      `#${card.id} ${card.title} 归你了（${owner} → 在做）。`,
      doing.length ? `提醒：你手上还有 ${doing.map((c) => '#' + c.id).join('、')} 没结束。一张做完再开下一张，不然两边都半截。` : '',
      `收尾一定要调 op=done 或 op=drop，note 里写一句结论——不写的话这张卡会一直挂在「在做」，看板就停在那了。`,
    ].filter(Boolean).join('\n')
  }
  if (op === 'release') {
    const id = Number(args?.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('要给卡号 id')
    const card = await saveCard(dir, { id, owner: '' })
    return `#${card.id} ${card.title} 已交回待领（没人做）。`
  }
  if (op !== 'list' && op !== 'next') throw new Error('op 只能是 list / add / move / claim / release / done / drop / reopen / next')

  const board = await loadBoard(dir)
  const cards = board.cards.map((c) => ({ ...c, next: recommend(c, board.cards), blocked: blockersOf(c, board.cards) }))
  const next = nextOf(cards)
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped' && c.kind !== 'map')
  const map = mapOf(board.cards)
  const lines = [`看板 ${dir} · 开着 ${open.length} 张，共 ${cards.length} 张`]
  if (map) lines.push(`地图 #${map.id} ${map.title}`)
  lines.push('')

  const ready = open.filter((c) => !c.blocked.length && !c.owner)
  const busy = open.filter((c) => c.owner)
  const waiting = open.filter((c) => c.blocked.length)
  const row = (c) =>
    `#${c.id} [${kindZh(c.kind)}·${stateZh(c.state)}] ${c.title}`
    + (c.next ? `  → /${c.next.skill}` : '')
    + (c.blocked?.length ? `（等 #${c.blocked.join(' #')}）` : '')
    + (c.owner ? `（${c.owner} 在做）` : '')
    + (c.scope?.length ? `  ⟨${c.scope.join(' ')}⟩` : '')
  if (ready.length) lines.push('可开工（前置齐、没人认领）：', ...ready.map(row), '')
  if (busy.length) lines.push('在做：', ...busy.map(row), '')
  if (waiting.length) lines.push('被挡着：', ...waiting.map(row), '')
  const { pairs, unscoped } = conflictsOf(board.cards)
  if (pairs.length) {
    lines.push('', '⚠ 并行冲突：')
    for (const p of pairs) lines.push(`  #${p.a} 与 #${p.b} 都要动 ${p.paths.join('、')} —— 先串行，别同时改`)
  }
  if (unscoped.length) lines.push('', `没写 scope 的在做卡：#${unscoped.join(' #')}（面板没法判断会不会打架）`)
  if (next) lines.push('', `下一步：/${next.skill} —— ${next.why}（卡 #${next.card.id} ${next.card.title}）`)
  else lines.push('', '没有开着的卡了。')
  return lines.join('\n')
}

export function apply(ctx) {
  const tools = ctx?.tools
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[pstack] tools 服务不在，工具行起不来')
  }

  tools.register({
    name: 'pstack_list',
    description:
      '列出 pstack 的技能清单（58 个：24 条工程准则 + 34 条工作流），每条带中文一句话、参数提示和依赖。'
      + '按 group 或 query 过滤。想知道某个技能怎么用，接着调 pstack_use。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '按名字/中文/英文描述过滤，例如 "验证" 或 tdd' },
        group: {
          type: 'string',
          description: '只看某一组：core / architecture / verification / delegation / meta / workflow',
        },
      },
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: list,
  })

  tools.register({
    name: 'pstack_use',
    description:
      '取一个 pstack 技能的完整正文，并把它当作这次任务的操作说明（技能里写着该怎么做、什么时候算做完）。'
      + '不确定名字就先 pstack_list。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名，例如 tdd / architect / principle-prove-it-works' },
        task: { type: 'string', description: '这次要它干的具体任务，一句话' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: use,
  })

  tools.register({
    name: 'pstack_playbook',
    description:
      'pstack 的技能之间没有硬顺序——顺序在剧本里（22 套：bug-fix / feature / refactoring / investigation …）。'
      + '不给 name 就列全部剧本；给 name 就摊开它的编号步骤，以及每一步点名要用哪些技能。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '剧本名，例如 bug-fix；不给就列全部' },
      },
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: async (args) => {
      const known = new Set((await catalog()).skills.map((s) => s.name))
      const name = String(args?.name ?? '').trim()
      if (!name) {
        const all = await listPlaybooks(known)
        const rows = all.filter((p) => p.steps.length)
        return [
          `pstack 剧本 ${rows.length} 套（技能之间的先后就在这里面）：`,
          ...rows.map((p) => `- ${p.slug} — ${p.title}（${p.steps.length} 步）第一步：/${p.firstSkill}`),
          '要看某套的步骤：pstack_playbook name=bug-fix',
        ].join('\n')
      }
      const play = await playbookByName(name, known)
      if (!play) throw new Error(`没有这套剧本：${name}（先 pstack_playbook 看全部）`)
      return [
        `《${play.title || play.slug}》${play.steps.length} 步：`,
        ...play.steps.map((st) => `${st.n}. ${st.text}${st.skills.length ? `\n   → ${st.skills.map((x) => '/' + x).join(' ')}` : ''}`),
      ].join('\n')
    },
  })

  tools.register({
    name: 'pstack_install',
    description:
      '把 pstack 技能装进某个项目的项目级技能目录（<项目>/.dsh/skills），让那个项目新开的会话也能用。'
      + '不给 names 就装全部 58 个；默认连依赖一起装。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '项目的绝对路径' },
        names: { type: 'array', items: { type: 'string' }, description: '要装哪几个技能；不给就是全部' },
        withDeps: { type: 'boolean', description: '连依赖一起装，默认 true' },
      },
      required: ['dir'],
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: install,
  })

  tools.register({
    name: 'pstack_board',
    description:
      '项目看板（存在 <项目>/.pstack/board/ 的 markdown 卡里）。一张卡的生命周期只有一条路：'
      + 'add 建 → claim 认领（变 doing）→ 干活 → done 或 drop 收尾（必须带一句结论）。'
      + '认领之后一定要走到 done/drop，否则这张卡会一直挂在「在做」，整个看板就停在那儿——'
      + '这就是闭环。结束了想再干就 reopen。op=list 看全景，op=next 只要下一步。',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['list', 'add', 'move', 'claim', 'release', 'done', 'drop', 'reopen', 'next'],
          description: 'list 看板 / add 建卡 / claim 认领 / move 改 todo|doing / done 做完 / drop 废弃 / reopen 重开 / release 交回 / next 下一步',
        },
        title: { type: 'string', description: 'add 时必给：这张卡要干什么' },
        body: { type: 'string', description: 'add 时的详细说明（markdown）' },
        kind: { type: 'string', enum: ['idea', 'bug', 'task', 'map'], description: 'add 时给：想法 / 缺陷 / 任务 / 地图（一块板一张，写清去向）' },
        id: { type: 'number', description: 'move 时必给：卡号' },
        state: { type: 'string', enum: ['idea', 'todo', 'doing', 'done', 'dropped'], description: 'move 时给：新状态' },
        note: { type: 'string', description: 'move 时的进展说明；done/drop 时必给：这次做成了什么、验过什么，或为什么不做了' },
        after: { type: 'array', items: { type: 'number' }, description: 'add 时给：要等哪几张卡先做完（卡号）' },
        parent: { type: 'number', description: 'add 时给：挂在哪张卡下面（通常是地图的卡号）' },
        scope: { type: 'array', items: { type: 'string' }, description: 'add 时给：这张卡能动哪些路径，用来判断并行会不会打架' },
        playbook: { type: 'string', description: 'add 时给：这张卡按哪套剧本走（bug-fix / feature / refactoring …，用 pstack_playbook 看全部）' },
        step: { type: 'number', description: 'add 时给：这套剧本的第几步' },
        owner: { type: 'string', description: '认领人；claim 不给就用当前会话号' },
        dir: { type: 'string', description: '项目绝对路径；不给就用当前会话的工作目录' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: (args, exec) => boardTool(args, exec, ctx),
  })

  tools.register({
    name: 'pstack_init',
    description:
      '初始化一个项目的看板：建 .pstack/board/ 的地图卡、.pstack/README.md、并在 AGENTS.md 里留一段「## 项目看板」，'
      + '让以后每个会话的 agent 都知道开工先看板。重复调用安全，已存在的不重写。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '项目路径；不给就用当前会话的项目根' },
        title: { type: 'string', description: '地图卡标题，默认「<项目名> 的路线图」' },
      },
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: async (args, exec) => {
      const raw = String(args?.dir ?? '').trim() || exec?.cwd || process.cwd()
      const root = projectRoot(raw)
      const before = await detectInit(root)
      const out = await initProject(root, { title: args?.title })
      return [
        before.initialized ? `这个项目已经初始化过了：${root}` : `初始化完成：${root}`,
        out.created.length ? '新建：' + out.created.join('、') : '',
        out.skipped.length ? '已有、没动：' + out.skipped.join('、') : '',
        out.initialized ? '看板已经可用，调 pstack_board op="list" 看板。' : `还缺：${out.missing.join('、')}`,
      ].filter(Boolean).join('\n')
    },
  })

  tools.register({
    name: 'pstack_suggest',
    description:
      '三层决策给出 3~5 条建议：本项目有开着的卡就按卡推，没有就扫别的项目，都没有就给开场建议。'
      + '每条带已经写好的提示词，直接发就行。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '项目绝对路径；不给就用当前工作目录' },
      },
      additionalProperties: false,
    },
    timeoutMs: TIMEOUT,
    output: text,
    execute: async (args, exec) => {
      const dir = String(args?.dir ?? '').trim() || exec?.cwd || process.cwd()
      const out = await suggest({ cwd: dir })
      const layer = { project: '按这个项目推', global: '看别的项目', seed: '先起个头' }[out.layer] || out.layer
      const lines = out.items.map((it, i) => [
        `${i + 1}. ${it.project ? '[' + it.project + '] ' : ''}${it.title}`,
        `   ${it.why}` + (it.certainty != null ? `（把握 ${it.certainty.toFixed(2)}）` : ''),
        `   ${it.prompt}`,
      ].join('\n'))
      return `建议接下来做这几件 · ${layer}\n\n${lines.join('\n\n')}`
    },
  })
}
