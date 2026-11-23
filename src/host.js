// dsh-pstack-deck · 宿主半
//
// 三件事，按顺序：
// 1. 把 pstack 的 58 个 SKILL.md 注册成 skill provider —— 让 `/` 菜单能直接列出来；
// 2. 开一条只读路由 /api/psp —— 面板在浏览器里没有文件系统，只能从这里拿目录；
// 3. 没有第 3 件。
//
// 不做的事：不复制技能到 ~/.dsh/skills，不调别的插件的私有 API，不往系统提示里加东西。

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

import {
  addProgress,
  answerOf,
  claimCard,
  finishCard,
  reopenCard,
  blockersOf,
  childrenOf,
  conflictsOf,
  frontierOf,
  graph,
  loadBoard,
  mapOf,
  mapSections,
  nextOf,
  recommend,
  saveCard,
  stateZh,
} from './board.js'
import { projectName, projectRoot, relFrom } from './anchor.js'
import { buildCatalog, toProviderItem, repoRoot, zhRoot, PROVIDER, PKG_ROOT } from './catalog.js'
import { detectInit, initProject } from './init.js'
import { suggest } from './suggest.js'
import { checkUpdate } from './update.js'
import { zhOf } from './i18n.js'

export const name = 'dsh-pstack-deck'
export const inject = ['skills', 'connection']

export const ROUTE = '/api/psp'
const RPC_ID = /^[A-Za-z0-9_-]{1,128}$/

/** 目录缓存：58 个文件重读一次约百毫秒，面板一次打开会连问两条，5 秒内复用。 */
let cache = { at: 0, value: null }

async function catalog({ fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && cache.value && now - cache.at < 5000) return cache.value
  const installedRoot = join(homedir(), '.dsh', 'skills')
  const value = await buildCatalog({ root: repoRoot(), installedRoot })
  cache = { at: now, value }
  return value
}

async function skillBody(skillName) {
  const cat = await catalog()
  const skill = cat.skills.find((s) => s.name === skillName)
  if (!skill) return { ok: false, error: 'no-such-skill', name: skillName }
  let body = ''
  try {
    body = await readFile(join(repoRoot(), 'skills', skillName, 'SKILL.md'), 'utf8')
  } catch (e) {
    return { ok: false, error: 'unreadable', message: String(e?.message ?? e) }
  }
  // 面板是给人读的：frontmatter 的名字/描述行只会占地方
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  let bodyZh = ''
  try {
    bodyZh = await readFile(join(zhRoot(), skillName + '.md'), 'utf8')
  } catch {
    /* 没翻就是没有，不是错误 */
  }
  return {
    ok: true,
    name: skillName,
    description: skill.description,
    argumentHint: skill.argumentHint,
    deps: skill.deps,
    missing: (cat.missingDeps[skillName] ?? []),
    principle: skill.principle,
    body,
    bodyZh,
  }
}

// 返回形状就是 connection.rpc.call 的解包契约：{ok:true, value} 或 {ok:false, error}。
const methods = {
  async update(payload) {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'))
    const r = await checkUpdate({ current: pkg.version, useCache: payload?.fresh !== true })
    return { ok: true, value: r }
  },
  async catalog(payload) {
    const cat = await catalog({ fresh: payload?.fresh === true })
    return {
      ok: true,
      value: {
        version: cat.version,
        groups: cat.groups,
        skills: cat.skills.map((skill) => ({ ...skill, zh: zhOf(skill) })),
        missingDeps: cat.missingDeps,
        drift: cat.drift,
        driftOk: cat.driftOk,
        installedRoot: cat.installedRoot,
      },
    }
  },
  async skill(payload) {
    const n = payload?.name
    if (typeof n !== 'string' || !/^[a-z0-9-]{1,64}$/.test(n)) return { ok: false, error: { code: 'bad-name', message: '技能名不合法' } }
    const out = await skillBody(n)
    if (!out.ok) return { ok: false, error: { code: out.error, message: out.message ?? '' } }
    return {
      ok: true,
      value: { ...out, zh: zhOf({ name: n, description: out.description }), principle: out.principle, body: out.body },
    }
  },

  // ---------------------------------------------------------------- 看板

  async board(payload, ctx) {
    const ws = resolveWorkspace(ctx, payload?.sessionId)
    const board = await loadBoard(ws.root)
    return { ok: true, value: await view(board, ws) }
  },

  /** 初始化：把一个陌生项目变成「有板可看」。重复点是安全的。 */
  async init(payload, ctx) {
    const ws = resolveWorkspace(ctx, payload?.sessionId)
    const out = await initProject(ws.root, { title: payload?.title })
    const board = await loadBoard(ws.root)
    return { ok: true, value: { ...(await view(board, ws)), created: out.created, skipped: out.skipped } }
  },

  async boardSave(payload, ctx) {
    const cwd = workspaceOf(ctx, payload?.sessionId)
    const id = payload?.id ? Number(payload.id) : undefined
    const title = String(payload?.title ?? '').trim()
    // 认领/交回/写 scope 都不改标题，所以只有新建卡才强制要一句标题
    if (!id && !title) return { ok: false, error: { code: 'no-title', message: '写一句这张卡要干什么' } }
    await saveCard(cwd, {
      id,
      kind: payload?.kind,
      state: payload?.state,
      title,
      body: payload?.body !== undefined ? String(payload.body) : undefined,
      owner: payload?.owner,
      scope: Array.isArray(payload?.scope) ? payload.scope : undefined,
      parent: payload?.parent !== undefined ? payload.parent : undefined,
      verify: payload?.verify,
      after: Array.isArray(payload?.after) ? payload.after : undefined,
    })
    return { ok: true, value: await view(await loadBoard(cwd), resolveWorkspace(ctx, payload?.sessionId)) }
  },

  /** 三层决策：项目层 → 全局层 → 开场建议，永远给 3~5 条带提示词的动作。 */
  async suggest(payload, ctx) {
    const cwd = workspaceOf(ctx, payload?.sessionId)
    return { ok: true, value: await suggest({ cwd }) }
  },

  async boardMove(payload, ctx) {
    const cwd = workspaceOf(ctx, payload?.sessionId)
    const id = Number(payload?.id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: { code: 'bad-id', message: '卡号不对' } }
    const note = String(payload?.note ?? '').trim()
    const state = payload?.state
    if (state === 'done' || state === 'dropped') {
      return { ok: false, error: { code: 'need-answer', message: '结束要走「完成 / 废弃」，并且写一句结论' } }
    }
    if (!note && !state) return { ok: false, error: { code: 'no-change', message: '要么改状态，要么写一句进展' } }
    try {
      await addProgress(cwd, id, note || `→ ${stateZh(state)}`, state)
    } catch (e) {
      return { ok: false, error: { code: 'no-card', message: String(e?.message ?? e) } }
    }
    return { ok: true, value: await view(await loadBoard(cwd), resolveWorkspace(ctx, payload?.sessionId)) }
  },

  /**
   * 闭环的四个动作，全都返回刷新后的整块板：
   * claim 认领、finish 收尾（done/drop，必须带结论）、reopen 重开、release 交回。
   * 面板点一下就走这里，所以状态和各处建议是同一帧刷新的，不会各说各话。
   */
  async boardAct(payload, ctx) {
    const cwd = workspaceOf(ctx, payload?.sessionId)
    const id = Number(payload?.id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: { code: 'bad-id', message: '卡号不对' } }
    const action = String(payload?.action ?? '').trim()
    const note = String(payload?.note ?? '').trim()
    let touched
    try {
      if (action === 'claim') touched = await claimCard(cwd, id, { owner: String(payload?.owner ?? 'me'), scope: Array.isArray(payload?.scope) ? payload.scope : [] })
      else if (action === 'done') touched = await finishCard(cwd, id, { state: 'done', note })
      else if (action === 'drop') touched = await finishCard(cwd, id, { state: 'dropped', note })
      else if (action === 'reopen') touched = await reopenCard(cwd, id, { note })
      else if (action === 'release') touched = await saveCard(cwd, { id, owner: '' })
      else return { ok: false, error: { code: 'bad-action', message: `不认识的 action：${action}` } }
    } catch (e) {
      return { ok: false, error: { code: 'rejected', message: String(e?.message ?? e) } }
    }
    const nextBoard = await loadBoard(cwd)
    return {
      ok: true,
      value: { ...(await view(nextBoard, resolveWorkspace(ctx, payload?.sessionId))), touched: { id: touched.id, state: touched.state } },
    }
  },
}

/** 面板要的形状：卡 + 每张卡的下一步建议 + 全局下一步 + 这是哪个项目、初始化到哪一步。 */
async function view(board, ws) {
  // blocked 与 next 一起下发：面板不用自己重算依赖，看到的和宿主推的是同一份判断
  const cards = board.cards.map((c) => ({
    ...c,
    next: recommend(c, board.cards),
    answer: answerOf(c),
    blocked: blockersOf(c, board.cards),
    children: childrenOf(board.cards, c.id).length,
  }))
  const next = nextOf(cards)
  const map = mapOf(board.cards)
  const where = ws ?? { cwd: board.cwd, root: board.cwd, name: projectName(board.cwd), rel: '' }
  const init = await detectInit(where.root)
  return {
    cwd: where.cwd,
    root: where.root,
    project: { name: init.name, missing: init.missing, initialized: init.initialized, rel: where.rel, mapId: init.mapId },
    dir: board.dir,
    cards,
    next,
    graph: graph(board.cards),
    frontier: frontierOf(board.cards).map((c) => c.id),
    conflicts: conflictsOf(board.cards),
    map: map ? { id: map.id, title: map.title, sections: mapSections(map), children: childrenOf(board.cards, map.id).length } : null,
  }
}

export function apply(ctx) {
  registerProvider(ctx)
  registerRoute(ctx)
}

/**
 * 看板落在哪个项目里：面板发请求时带上会话号，宿主用 sessions 服务把它换成
 * 那个会话的工作目录，再上溯到项目根（会话 cwd 常常是 src/ 这种子目录，
 * 跟着 cwd 走会看见一块和根目录不相通的空板）。
 * 拿不到会话就退回进程 cwd —— 宁可落在错的地方让人看见，也不要静悄悄写到别处去。
 */
export function workspaceOf(ctx, sessionId, fallbackCwd) {
  try {
    const sessions = ctx.get('sessions')
    const session = sessionId && sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    const cwd = session?.header?.cwd
    if (typeof cwd === 'string' && cwd) return projectRoot(cwd)
  } catch {
    /* sessions 服务不在就往下退 */
  }
  // 工具调用拿得到 exec.cwd（宿主给的当前工作目录），面板调用拿不到 sessions 时才退回它。
  // 少了这一步，工具会把卡写进一个叫 unbound 的假项目里——人点开看板发现是空的。
  if (typeof fallbackCwd === 'string' && fallbackCwd) return projectRoot(fallbackCwd)
  // 最后的兜底也不能写进应用包里：那个目录是只读的，而且不是人的项目
  return join(homedir(), '.dsh', 'pstack-board', 'unbound')
}

/** 会话原始 cwd + 上溯后的项目根，两个都要：前者用来提示「你在子目录里」。 */
export function resolveWorkspace(ctx, sessionId) {
  let cwd = ''
  try {
    const sessions = ctx.get('sessions')
    const session = sessionId && sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    const raw = session?.header?.cwd
    if (typeof raw === 'string') cwd = raw
  } catch {
    /* 没有 sessions 服务就当成没有 cwd */
  }
  const root = cwd ? projectRoot(cwd) : workspaceOf(ctx, sessionId)
  return { cwd: cwd || root, root, name: projectName(root), rel: relFrom(root, cwd) }
}

function registerProvider(ctx) {
  const skills = ctx.get('skills')
  if (!skills || typeof skills.registerProvider !== 'function') {
    console.warn('[pstack] skills 服务不在，provider 起不来；`/` 菜单里不会出现 pstack 技能')
    return
  }

  const provider = {
    name: PROVIDER,
    async list() {
      const cat = await catalog()
      return cat.skills.map(toProviderItem)
    },
    async get(candidate, opts) {
      if (opts?.signal?.aborted) throw opts.signal.reason
      const p = candidate?.locator?.path ?? candidate?.path
      if (!p) return undefined
      let raw
      try {
        raw = await readFile(p, 'utf8')
      } catch {
        return undefined
      }
      const item = (await catalog()).skills.find((s) => s.name === candidate.name)
      if (!item) return undefined
      const { rank: _rank, locator: _locator, ...summary } = toProviderItem(item)
      return { ...summary, content: raw }
    },
  }

  // 注册放在 ctx.effect 里：热重载会先执行 disposer，否则旧 provider 一直挂在
  // fiber 上，同一批技能被两份快照服务（ponytail 踩过，这里照抄结论）。
  try {
    ctx.effect(() => {
      const dispose = skills.registerProvider(() => provider)
      console.log('[pstack] skill provider 已注册，58 个技能会出现在斜杠菜单里')
      return () => {
        try {
          dispose()
        } catch (e) {
          console.warn('[pstack] provider 注销失败：' + String(e?.message ?? e))
        }
      }
    }, 'dsh-pstack-deck: skill provider')
  } catch (e) {
    console.warn('[pstack] registerProvider 失败：' + String(e?.message ?? e))
  }
}

function registerRoute(ctx) {
  const connection = ctx.get('connection')
  const registry = connection?.fetch
  if (!registry || typeof registry.register !== 'function') {
    console.warn('[pstack] connection.fetch 不在，面板拿不到目录（面板会显示“读不到目录”）')
    return
  }

  const route = async (request) => {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    let body
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    const rpcId = typeof body?.rpcId === 'string' && RPC_ID.test(body.rpcId) ? body.rpcId : 'invalid-request'
    const call = body?.payload
    if (body?.type !== 'client-request' || !call || typeof call.method !== 'string') {
      return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: 'bad-envelope' } })
    }
    const fn = methods[call.method]
    if (!fn) {
      return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: 'unknown-method', method: call.method } })
    }
    let result
    try {
      result = await fn(call.payload, ctx)
    } catch (e) {
      result = { ok: false, error: 'internal', message: String(e?.message ?? e) }
    }
    return Response.json({ type: 'server-response', rpcId, result })
  }

  try {
    ctx.effect(() => {
      const dispose = registry.register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: route })
      console.log(`[pstack] 面板路由 ${ROUTE} 已注册`)
      return () => {
        try {
          dispose()
        } catch {
          /* 路由已经不在了 */
        }
      }
    }, `dsh-pstack-deck: ${ROUTE}`)
  } catch (e) {
    console.warn(`[pstack] 路由 ${ROUTE} 注册失败：` + String(e?.message ?? e))
  }
}
