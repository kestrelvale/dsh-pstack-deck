// 宿主半的假 ctx 冒烟测试：不启动 DSH，直接看 apply() 注册出来的东西能不能用。
// 它抓的是形状错（provider 条目缺字段、路由信封对不上），这些错在真机上表现为
// 「面板一片空白」，很难查，所以在这里先钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import * as host from '../src/host.js'
import * as tools from '../src/tools.js'

function fakeCtx(opts = {}) {
  const out = { providers: [], routes: [], tools: [], effects: [] }
  const ctx = {
    get(name) {
      if (name === 'skills') {
        return {
          registerProvider(fn) {
            out.providers.push(fn())
            return () => {}
          },
        }
      }
      if (name === 'connection') {
        return {
          fetch: {
            register(route) {
              out.routes.push(route)
              return () => {}
            },
          },
        }
      }
      if (name === 'tools') {
        return { register(def) { out.tools.push(def) } }
      }
      if (name === 'sessions' && opts.cwd) {
        return { get: (sid) => (sid === opts.sid ? { header: { cwd: opts.cwd } } : undefined) }
      }
      return undefined
    },
    // cordis 语义：effect(fn) 立刻执行 fn，卸载时调用它返回的 disposer
    effect(fn) { out.effects.push(fn()) },
    tools: undefined,
  }
  ctx.tools = ctx.get('tools')
  return { ctx, out }
}

const post = (route, body) => route.fetch(new Request('http://x' + route.path, { method: 'POST', body: JSON.stringify(body) }))

test('宿主半：provider 列出 58 条，条目字段齐、get() 带正文', async () => {
  const { ctx, out } = fakeCtx()
  host.apply(ctx)
  assert.equal(out.providers.length, 1)

  const provider = out.providers[0]
  assert.equal(provider.name, 'bundled-pstack')
  const list = await provider.list()
  assert.equal(list.length, 58)
  for (const item of list) {
    assert.equal(typeof item.name, 'string')
    assert.equal(typeof item.description, 'string')
    assert.equal(typeof item.invocation.modelInvocable, 'boolean')
    assert.equal(item.source, 'bundled')
    assert.equal(item.provider, 'bundled-pstack')
    assert.equal(typeof item.rank, 'number')
    assert.equal(item.locator.path.endsWith(join(item.name, 'SKILL.md')), true)
  }

  const pick = list.find((i) => i.name === 'tdd')
  const got = await provider.get(pick, {})
  assert.equal(got.name, 'tdd')
  assert.equal(got.rank, undefined, 'get() 不回 rank')
  assert.equal(got.locator, undefined, 'get() 不回 locator')
  assert.match(got.content, /^---\n/)

  // 名字对不上的候选要返回 undefined，而不是随便给一份正文
  assert.equal(await provider.get({ ...pick, name: 'nope' }, {}), undefined)
})

test('宿主半：/api/psp 走 POST 信封，catalog 与 skill 都能取', async () => {
  const { ctx, out } = fakeCtx()
  host.apply(ctx)
  assert.equal(out.routes.length, 1)
  const route = out.routes[0]
  assert.equal(route.path, '/api/psp')
  assert.deepEqual(route.methods, ['POST'])

  const ok = await (await post(route, { type: 'client-request', rpcId: 'r1', payload: { method: 'catalog', payload: {} } })).json()
  assert.equal(ok.type, 'server-response')
  assert.equal(ok.rpcId, 'r1')
  assert.equal(ok.result.ok, true)
  assert.equal(ok.result.value.skills.length, 58)
  assert.equal(typeof ok.result.value.skills[0].zh, 'string', '面板要中文一句话')
  assert.equal(typeof ok.result.value.version, 'string')
  assert.equal(typeof ok.result.value.driftOk, 'boolean')

  const one = await (await post(route, { type: 'client-request', rpcId: 'r2', payload: { method: 'skill', payload: { name: 'tdd' } } })).json()
  assert.equal(one.result.ok, true)
  assert.match(one.result.value.body, /tdd/i)

  const bad = await (await post(route, { type: 'client-request', rpcId: 'r3', payload: { method: 'skill', payload: { name: '../etc/passwd' } } })).json()
  assert.equal(bad.result.ok, false, '路径穿越的名字要挡住')

  const unknown = await (await post(route, { type: 'client-request', rpcId: 'r4', payload: { method: 'nope', payload: {} } })).json()
  assert.equal(unknown.result.error, 'unknown-method')

  const noBody = await route.fetch(new Request('http://x/api/psp', { method: 'GET' }))
  assert.equal(noBody.status, 405)
})

test('工具半：pstack_list 有清单，pstack_use 给正文，坏名字报错', async () => {
  const { ctx, out } = fakeCtx()
  tools.apply(ctx)
  assert.deepEqual(out.tools.map((t) => t.name).sort(), ['pstack_board', 'pstack_init', 'pstack_install', 'pstack_list', 'pstack_suggest', 'pstack_use'])

  const list = out.tools.find((t) => t.name === 'pstack_list')
  const text = await list.execute({}, {})
  assert.match(text, /58 个技能/)
  assert.match(text, /tdd — 先写一个会失败的测试/)

  const filtered = await list.execute({ query: '验证' }, {})
  assert.match(filtered, /筛出/)
  assert.doesNotMatch(filtered, /tdd —/)

  const use = out.tools.find((t) => t.name === 'pstack_use')
  const body = await use.execute({ name: 'tdd', task: '给登录加个测试' }, {})
  assert.match(body, /你在执行 pstack 技能 tdd/)
  assert.match(body, /这次的任务：给登录加个测试/)
  assert.match(body, /技能正文/)
  await assert.rejects(() => use.execute({ name: 'nope-skill' }, {}), /没有 nope-skill 这个技能/)
  await assert.rejects(() => use.execute({ name: '../x' }, {}), /必须是技能名/)
})

test('装到项目：拷进 <项目>/.dsh/skills，带依赖，坏路径报错', async () => {
  const { mkdtemp, readdir, rm, writeFile, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { ctx, out } = fakeCtx()
  tools.apply(ctx)
  const install = out.tools.find((t) => t.name === 'pstack_install')

  const proj = await mkdtemp(join(tmpdir(), 'pstack-proj-'))
  try {
    const msg = await install.execute({ dir: proj, names: ['teach'] }, {})
    assert.match(msg, /已装 3 个技能/)
    assert.match(msg, /同装依赖/)
    const got = (await readdir(join(proj, '.dsh', 'skills'))).sort()
    assert.deepEqual(got, ['how', 'teach', 'why'])
    assert.match(await readFile(join(proj, '.dsh', 'skills', 'teach', 'SKILL.md'), 'utf8'), /name: teach/)

    await assert.rejects(() => install.execute({ dir: 'rel/path' }, {}), /绝对路径/)
    await assert.rejects(() => install.execute({ dir: join(proj, 'nope') }, {}), /没有这个目录/)
    await assert.rejects(() => install.execute({ dir: proj, names: ['nope'] }, {}), /没有这些技能/)
  } finally {
    await rm(proj, { recursive: true, force: true })
  }
})

test('中文正文：zh/<name>.md 存在时随 skill 一起返回，正文工具优先用它', async () => {
  const { mkdir, writeFile, rm } = await import('node:fs/promises')
  const cat = await import('../src/catalog.js')
  const zhDir = cat.zhRoot()
  await mkdir(zhDir, { recursive: true })
  const file = join(zhDir, 'bro.md')
  // 这个文件是真译文：写完必须还原，不然测试会把 zh/bro.md 删掉
  const prev = await readFile(file, 'utf8').catch(() => null)
  await writeFile(file, '# 人话\n\n把上一条消息翻成人话。\n')
  try {
    const { ctx, out } = fakeCtx()
    host.apply(ctx)
    tools.apply(ctx)
    const route = out.routes[0]
    const r2 = await post(route, { type: 'client-request', rpcId: 'z1', payload: { method: 'skill', payload: { name: 'bro' } } })
    const body2 = await r2.json()
    assert.equal(body2.result.ok, true)
    assert.equal(body2.result.value.bodyZh.trim().startsWith('# 人话'), true)

    const use = out.tools.find((t) => t.name === 'pstack_use')
    const body = await use.execute({ name: 'bro' }, {})
    assert.match(body, /技能正文（中文）/)
    assert.match(body, /把上一条消息翻成人话/)
  } finally {
    if (prev === null) await rm(file, { force: true })
    else await writeFile(file, prev)
  }
})

test('看板：路由能建卡、改状态、给出下一步，卡落在项目目录里', async () => {
  const { mkdtemp, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const proj = await mkdtemp(join(tmpdir(), 'pstack-route-'))
  try {
    const { ctx, out } = fakeCtx({ cwd: proj, sid: 's1' })
    host.apply(ctx)
    const route = out.routes[0]
    const rpc = async (rpcId, method, payload) =>
      (await post(route, { type: 'client-request', rpcId, payload: { method, payload } })).json()

    const empty = await rpc('b0', 'board', { sessionId: 's1' })
    assert.equal(empty.result.value.cards.length, 0)
    assert.equal(empty.result.value.next, null)

    const bad = await rpc('b1', 'boardSave', { sessionId: 's1', title: '   ' })
    assert.equal(bad.result.ok, false, '空标题要拦住')

    const made = await rpc('b2', 'boardSave', { sessionId: 's1', title: '登录后偶发 401', kind: 'bug' })
    const card = made.result.value.cards[0]
    assert.equal(card.kind, 'bug')
    assert.equal(made.result.value.next.skill, 'tdd')
    assert.deepEqual(await readdir(join(proj, '.pstack', 'board')), ['1-登录后偶发-401.md'])

    const moved = await rpc('b3', 'boardMove', { sessionId: 's1', id: card.id, state: 'doing', note: '开始查' })
    assert.equal(moved.result.value.cards[0].state, 'doing')
    assert.equal(moved.result.value.cards[0].progress, 1)
    assert.equal(moved.result.value.next.skill, 'correct', '在做中的 bug 该去把它变成规则')

    // 结束不再是「改个状态」，而是一次带结论的动作
    const noNote = await rpc('b3x', 'boardAct', { sessionId: 's1', id: card.id, action: 'done' })
    assert.equal(noNote.result.ok, false, '没写结论不能完成')
    assert.match(noNote.result.error.message, /结论/)

    const finished = await rpc('b3y', 'boardAct', { sessionId: 's1', id: card.id, action: 'done', note: '加了 cookie 重试' })
    assert.equal(finished.result.value.cards[0].state, 'done')
    assert.equal(finished.result.value.cards[0].answer, '加了 cookie 重试')
    assert.equal(finished.result.value.next, null, '做完了就不该再推荐下一步')

    const reopened = await rpc('b3z', 'boardAct', { sessionId: 's1', id: card.id, action: 'reopen', note: '还有一处没修' })
    assert.equal(reopened.result.value.cards[0].state, 'todo', '废弃/完成的都能重开')
    assert.equal(reopened.result.value.next.skill, 'tdd')

    const dropped = await rpc('b4', 'boardAct', { sessionId: 's1', id: card.id, action: 'drop', note: '不修了，改用别的方案' })
    assert.equal(dropped.result.value.cards[0].state, 'dropped')
    assert.equal(dropped.result.value.next, null, '废弃了就不该再推荐下一步')
    assert.equal(dropped.result.value.cards[0].owner, undefined)

    const noChange = await rpc('b5', 'boardMove', { sessionId: 's1', id: 1 })
    assert.equal(noChange.result.ok, false)
    const noCard = await rpc('b6', 'boardMove', { sessionId: 's1', id: 42, note: 'x' })
    assert.equal(noCard.result.ok, false)
  } finally {
    await rm(proj, { recursive: true, force: true })
  }
})

test('初始化：路由能把空项目变成有板可看，子目录会话也落在项目根', async () => {
  const { mkdtemp, mkdir, rm, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const proj = await mkdtemp(join(tmpdir(), 'pstack-init-route-'))
  try {
    await mkdir(join(proj, '.git'))
    await mkdir(join(proj, 'src', 'api'), { recursive: true })

    // 会话 cwd 在子目录里：看板必须落在项目根，否则根目录和子目录会是两块不相通的板
    const { ctx, out } = fakeCtx({ cwd: join(proj, 'src', 'api'), sid: 's2' })
    host.apply(ctx)
    const route = out.routes[0]
    const rpc = async (rpcId, method, payload) =>
      (await post(route, { type: 'client-request', rpcId, payload: { method, payload } })).json()

    const empty = await rpc('i0', 'board', { sessionId: 's2' })
    assert.equal(empty.result.value.root, proj)
    assert.equal(empty.result.value.project.initialized, false)
    assert.equal(empty.result.value.project.rel, 'src/api')
    assert.deepEqual(empty.result.value.project.missing, ['board', 'readme', 'agents'])

    const done = await rpc('i1', 'init', { sessionId: 's2' })
    assert.equal(done.result.value.project.initialized, true)
    assert.equal(done.result.value.created.length, 3)
    assert.equal(done.result.value.cards[0].kind, 'map')
    assert.match(await readFile(join(proj, 'AGENTS.md'), 'utf8'), /## 项目看板/)

    const again = await rpc('i2', 'init', { sessionId: 's2' })
    assert.deepEqual(again.result.value.created, [], '重复初始化不重写')
  } finally {
    await rm(proj, { recursive: true, force: true })
  }
})

test('看板工具：list 给下一步，add 建卡，move 改状态', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const proj = await mkdtemp(join(tmpdir(), 'pstack-tool-'))
  try {
    const { ctx, out } = fakeCtx()
    tools.apply(ctx)
    const boardTool = out.tools.find((t) => t.name === 'pstack_board')

    const added = await boardTool.execute({ op: 'add', dir: proj, title: '把导出改成流式', kind: 'idea' }, {})
    assert.match(added, /已记入看板：#1/)
    const listed = await boardTool.execute({ op: 'list', dir: proj }, {})
    assert.match(listed, /下一步：\/figure-it-out/)
    assert.match(listed, /把导出改成流式/)
    // 用 move 偷懒结束要被拦住：结束必须是一次带结论的动作
    await assert.rejects(() => boardTool.execute({ op: 'move', dir: proj, id: 1, state: 'done' }, {}), /结束要走 op=done/)
    await assert.rejects(() => boardTool.execute({ op: 'done', dir: proj, id: 1 }, {}), /结论/)

    const done = await boardTool.execute({ op: 'done', dir: proj, id: 1, note: '导出改成流式了，跑过大文件' }, {})
    assert.match(done, /→ 完成/)
    assert.match(done, /结论已写进卡里/)

    const after = await boardTool.execute({ op: 'list', dir: proj }, {})
    assert.match(after, /没有开着的卡/)

    const reopened = await boardTool.execute({ op: 'reopen', dir: proj, id: 1, note: '再补个空文件用例' }, {})
    assert.match(reopened, /已重开/)
    assert.doesNotMatch(await boardTool.execute({ op: 'list', dir: proj }, {}), /没有开着的卡/)
    await assert.rejects(() => boardTool.execute({ op: 'add', dir: proj, title: '  ' }, {}), /写一句/)
    await assert.rejects(() => boardTool.execute({ op: 'nope', dir: proj }, {}), /op 只能是/)
  } finally {
    await rm(proj, { recursive: true, force: true })
  }
})

test('建议工具：给 3~5 条，每条都带能直接发的提示词', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'pstack-sug-tool-'))
  try {
    const { ctx, out } = fakeCtx({ cwd: dir, sid: 's1' })
    tools.apply(ctx)
    const t = out.tools.find((x) => x.name === 'pstack_suggest')
    const empty = await t.execute({ dir }, {})
    // 空项目：要么给开场建议（先起个头），要么去别的项目里翻出真活（看别的项目）——
    // 后者取决于这台机器上别的项目有没有板，别把断言钉死在环境上。
    assert.match(empty, /先起个头|看别的项目/)
    assert.match(empty, /\/in-your-own-words|\/figure-it-out|\/architect|\/tdd/)

    const { saveCard } = await import('../src/board.js')
    await saveCard(dir, { kind: 'bug', title: '登录后偶发 401，刷新一次就好', body: 'Safari 复现' })
    const filled = await t.execute({ dir }, {})
    assert.match(filled, /按这个项目推/)
    assert.match(filled, /\/tdd #\d+ 登录后偶发 401/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('更新检查：路由走通，查不到时给的是错误不是「最新」', async () => {
  const { ctx, out } = fakeCtx()
  host.apply(ctx)
  const route = out.routes.find((r) => r.path === '/api/psp')
  const res = await post(route, { type: 'client-request', rpcId: 'u1', payload: { method: 'update', payload: { fresh: true } } })
  const body = await res.json()
  assert.equal(body.result.ok, true)
  assert.equal(typeof body.result.value.current, 'string')
  assert.match(body.result.value.current, /^\d+\.\d+\.\d+/)
  // 真联网的那一次结果不确定，但形状必须稳：要么有 latest，要么有 error
  assert.ok(body.result.value.latest || body.result.value.error)
})
