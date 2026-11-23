// 看板层：一个项目一个 .pstack/board/，一张卡一个 markdown 文件。
// 钉的是「文件是真的 markdown、状态真的落盘、下一步推荐是规则不是随缘」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addProgress,
  boardRoot,
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
