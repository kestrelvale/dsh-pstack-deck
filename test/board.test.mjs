// 看板层：一个项目一个 .pstack/board/，一张卡一个 markdown 文件。
// 钉的是「文件是真的 markdown、状态真的落盘、下一步推荐是规则不是随缘」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addProgress,
  boardRoot,
  cyclesOf,
  graph,
  conflictsOf,
  frontierOf,
  loadBoard,
  mapOf,
  mapSections,
  nextOf,
  recommend,
  saveCard,
} from '../src/board.js'

const tmp = () => mkdtemp(join(tmpdir(), 'pstack-board-'))

test('建卡落在 markdown 文件里，字段能读回来', async () => {
  const dir = await tmp()
  try {
    const card = await saveCard(dir, { kind: 'bug', title: '登录后偶发 401', body: '刷新一次就好' })
    assert.equal(card.id, 1)
    const files = await readdir(boardRoot(dir))
    assert.deepEqual(files, ['1-登录后偶发-401.md'])
    const raw = await readFile(join(boardRoot(dir), files[0]), 'utf8')
    assert.match(raw, /^---\nid: 1\nkind: bug\nstate: idea\n/)
    assert.match(raw, /登录后偶发 401/)

    const board = await loadBoard(dir)
    assert.equal(board.cards.length, 1)
    assert.equal(board.cards[0].kind, 'bug')
    assert.equal(board.cards[0].body.trim(), '刷新一次就好')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('推进展带日期，顺带改状态；改标题会改文件名', async () => {
  const dir = await tmp()
  try {
    const card = await saveCard(dir, { kind: 'task', title: '旧标题' })
    const moved = await addProgress(dir, card.id, '开始动手', 'doing')
    assert.equal(moved.state, 'doing')
    assert.match(moved.body, /^- \d{4}-\d{2}-\d{2} \[在做\] 开始动手$/m)

    await saveCard(dir, { id: card.id, title: '新标题' })
    const files = await readdir(boardRoot(dir))
    assert.equal(files.length, 1, '改名不能留下旧文件')
    assert.match(files[0], /^1-新标题\.md$/)
    const board = await loadBoard(dir)
    assert.equal(board.cards[0].progress, 1)
    await assert.rejects(() => addProgress(dir, 99, '不存在'), /没有第 99 号卡/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('下一步推荐：缺陷先写测试，太粗的卡先变具体，在做要先证明', () => {
  assert.equal(recommend({ kind: 'bug', state: 'todo', title: '登录偶发 401' }).skill, 'tdd')
  assert.equal(recommend({ kind: 'bug', state: 'doing', title: '登录偶发 401' }).skill, 'correct')
  assert.equal(recommend({ kind: 'idea', state: 'idea', title: '快一点', body: '' }).skill, 'sharpen')
  assert.equal(recommend({ kind: 'idea', state: 'idea', title: '把导出改成流式的，别一次读进内存' }).skill, 'figure-it-out')
  assert.equal(recommend({ kind: 'task', state: 'doing', title: '给看板加列筛选' }).skill, 'prove-it-works')
  assert.equal(recommend({ kind: 'task', state: 'todo', title: '给看板加列筛选' }).skill, 'architect')
  assert.equal(recommend({ kind: 'task', state: 'done', title: '做完了' }), null)
  assert.equal(recommend({ kind: 'task', state: 'dropped', title: '不做了' }), null)

  const cards = [
    { id: 1, kind: 'idea', state: 'todo', title: '先做这个想法' },
    { id: 2, kind: 'bug', state: 'doing', title: '正在修的 bug' },
  ]
  assert.equal(nextOf(cards).card.id, 2, '在做优先于待办')
})

test('看板目录不存在时是空板，不是错误', async () => {
  const dir = await tmp()
  try {
    const board = await loadBoard(dir)
    assert.deepEqual(board.cards, [])
    assert.equal(nextOf([]), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('并行：前置没做完的、别人认领的，都不算可开工', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '先把数据层换掉', body: '细节' })
    const b = await saveCard(dir, { kind: 'task', title: '再改调用方', body: '细节', after: [a.id] })
    const c = await saveCard(dir, { kind: 'task', title: '顺手补日志', body: '细节' })
    const cards = (await loadBoard(dir)).cards
    assert.deepEqual(frontierOf(cards).map((x) => x.id), [a.id, c.id])
    assert.equal(recommend(cards.find((x) => x.id === b.id), cards), null, '被挡着的卡不推技能')

    // 认领之后从可开工里消失，另一个会话就不会来抢
    await saveCard(dir, { id: a.id, owner: 'sess-1', state: 'doing' })
    const after = (await loadBoard(dir)).cards
    assert.deepEqual(frontierOf(after).map((x) => x.id), [c.id])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('并行：两张在做的卡动了同一块路径就报冲突', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '改接口返回', body: 'x', scope: ['src/api'], owner: 's1', state: 'doing' })
    const b = await saveCard(dir, { kind: 'task', title: '补接口测试', body: 'x', scope: ['src/api/user.ts'], owner: 's2', state: 'doing' })
    const c = await saveCard(dir, { kind: 'task', title: '改文档', body: 'x', scope: ['docs'], owner: 's3', state: 'doing' })
    const cards = (await loadBoard(dir)).cards
    const { pairs } = conflictsOf(cards)
    assert.equal(pairs.length, 1)
    assert.deepEqual([pairs[0].a, pairs[0].b].sort(), [a.id, b.id].sort())
    assert.match(pairs[0].paths.join(), /src\/api/)

    // 同一个 owner 自己排先后，不算打架
    await saveCard(dir, { id: b.id, owner: 's1' })
    assert.equal(conflictsOf((await loadBoard(dir)).cards).pairs.length, 0)
    assert.equal(c.id > 0, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('地图：四段正文切得出来，缺的就是空串', async () => {
  const dir = await tmp()
  try {
    const map = await saveCard(dir, {
      kind: 'map',
      title: '把导出改成流式',
      body: '## 去向\n大文件导出不 OOM\n\n## 已经定了\n用 node 的 stream\n\n## 还没想清\n断点续传要不要做\n',
    })
    await saveCard(dir, { kind: 'task', title: '换掉读取方式', parent: map.id, body: 'x' })
    const cards = (await loadBoard(dir)).cards
    const m = mapOf(cards)
    assert.equal(m.id, map.id)
    const sec = mapSections(m)
    assert.equal(sec.destination, '大文件导出不 OOM')
    assert.equal(sec.decisions, '用 node 的 stream')
    assert.equal(sec.fog, '断点续传要不要做')
    assert.equal(sec.out, '')
    assert.equal(cards.filter((c) => c.parent === map.id).length, 1)
    assert.equal(frontierOf(cards).some((c) => c.kind === 'map'), false, '地图本身不是可开工的活')
    assert.equal(graph(cards).nodes.some((n) => n.id === map.id), false, '拓扑图不画地图')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('下一步不会把地图当成活：全做完了就该说什么都没有', async () => {
  const dir = await tmp()
  try {
    const map = await saveCard(dir, { kind: 'map', title: '这次要去哪' })
    const card = await saveCard(dir, { kind: 'task', title: '把导出改成流式的' })
    assert.equal(nextOf((await loadBoard(dir)).cards).card.id, card.id, '有活的时候推活，不推地图')
    await addProgress(dir, card.id, '做完了', 'done')
    const board = await loadBoard(dir)
    assert.equal(mapOf(board.cards).id, map.id, '地图还在')
    assert.equal(nextOf(board.cards), null, '活全做完了就是没有下一步')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// 这一条对着真机上的现象：工具把卡写进了 ~/.dsh/pstack-board/unbound，
// 人在面板里点开看板一片空白。宿主的工具 exec 里没有 cwd、没有 sessionId，
// 工作目录在 exec.agent.session.header.cwd —— 走这条路才落在人自己的项目上。
test('工具认项目：从 exec.agent.session.header.cwd 上溯，不再落到 unbound', async () => {
  const { apply } = await import('../src/tools.js')
  const regs = []
  const ctx = {
    tools: { register: (d) => regs.push(d) },
    get: (n) => (n === 'sessions' ? undefined : undefined),
    effect: (f) => f(),
  }
  apply(ctx)
  const board = regs.find((r) => r.name === 'pstack_board')
  const dir = await tmp()
  try {
    const sub = join(dir, 'src', 'api')
    await mkdir(sub, { recursive: true })
    await mkdir(join(dir, '.pstack'), { recursive: true })
    const exec = { agent: { session: { header: { id: 's1', cwd: sub } } } }
    const out = await board.execute({ op: 'add', title: '登录后偶发 401', kind: 'bug' }, exec)
    assert.match(out, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '要落在项目根，不是子目录也不是 unbound')
    assert.ok(!out.includes('unbound'), '绝不能落到兜底目录')
    const files = await readdir(join(dir, '.pstack', 'board'))
    assert.equal(files.length, 1)
    assert.match(files[0], /登录后偶发-401/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// #18：op=add 带 parent 线上静默吞掉过，回的还是看板列表。这条钉住它。
test('工具建子卡带 parent：真落在盘上，父卡号记得住', async () => {
  const { apply } = await import('../src/tools.js')
  const regs = []
  apply({ tools: { register: (d) => regs.push(d) }, get: () => undefined, effect: (f) => f() })
  const board = regs.find((r) => r.name === 'pstack_board')
  const dir = await tmp()
  try {
    const exec = { agent: { session: { header: { id: 's1', cwd: dir } } } }
    assert.match(await board.execute({ op: 'add', kind: 'map', title: '这条路' }, exec), /#1 这条路/)
    assert.match(await board.execute({ op: 'add', kind: 'task', title: '挂在地图下', parent: 1 }, exec), /#2/)
    const files = await readdir(join(dir, '.pstack', 'board'))
    const kid = files.find((f) => f.endsWith('.md') && /挂在地图下/.test(f))
    assert.ok(kid, `子卡文件要真的存在：${files.join('、')}`)
    assert.match(await readFile(join(dir, '.pstack', 'board', kid), 'utf8'), /parent: 1/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('工具改卡带旧版本号：拒写，报 conflict 并给下一步', async () => {
  const { apply } = await import('../src/tools.js')
  const regs = []
  apply({ tools: { register: (d) => regs.push(d) }, get: () => undefined, effect: (f) => f() })
  const board = regs.find((r) => r.name === 'pstack_board')
  const dir = await tmp()
  try {
    const exec = { agent: { session: { header: { id: 's1', cwd: dir } } } }
    await board.execute({ op: 'add', kind: 'task', title: '别覆盖我' }, exec)
    const { cards } = await loadBoard(dir)
    const [card] = cards
    const err = await board
      .execute({ op: 'move', id: card.id, state: 'doing', expectedUpdatedAt: card.at - 5000 }, exec)
      .then(() => null, (e) => e)
    assert.equal(err?.kind, 'conflict')
    assert.match(err.message, /一个字都没写/)
    assert.equal((await loadBoard(dir)).cards[0].state, 'idea', '状态不能被改')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// 环：卡是人手写的 markdown，依赖成环随时能写出来，而且环里的卡谁都开不了工。
test('依赖成环：两条互等被揪出来，自等和正常链不误报', () => {
  const cards = [
    { id: 1, after: [2] },
    { id: 2, after: [1] },
    { id: 3, after: [4] },
    { id: 4, after: [] },
    { id: 5, after: [5] },
    { id: 6, after: [99] }, // 指着不存在的卡：不是环
  ]
  const rings = cyclesOf(cards)
  assert.equal(rings.length, 1)
  assert.deepEqual(rings[0], [1, 2, 1], '要能看出从哪回到哪')
  assert.deepEqual(conflictsOf(cards).rings, rings, '看板把它当冲突一起报')
})

test('父子成环：子卡成了父卡的祖先也报出来', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '甲' })
    const b = await saveCard(dir, { kind: 'task', title: '乙', parent: a.id })
    await saveCard(dir, { id: a.id, title: '甲', parent: b.id }) // 手写出来的环
    const rings = (await loadBoard(dir)).cards.length && conflictsOf((await loadBoard(dir)).cards).rings
    assert.equal(rings.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
