// 三层决策：项目层 → 全局层 → 开场建议。
// 钉的是「永远给 3~5 条、每条都带能直接发的提示词、层级按有没有卡来选」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addProgress, saveCard } from '../src/board.js'
import { suggest } from '../src/suggest.js'

const tmp = () => mkdtemp(join(tmpdir(), 'pstack-sug-'))
const shapeOk = (out) => {
  assert.ok(out.items.length >= 3 && out.items.length <= 5, `要 3~5 条，实际 ${out.items.length}`)
  for (const it of out.items) {
    assert.equal(typeof it.skill, 'string')
    assert.match(it.prompt, /^\/[a-z-]+ /, '提示词得是能直接发的一条斜杠命令：' + it.prompt)
    assert.ok(it.why, '每条都得说清为什么')
  }
}

test('项目层：这个项目有开着的卡，就按卡推，且在做的排前面', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '给看板加筛选' })
    const b = await saveCard(dir, { kind: 'bug', title: '登录后偶发 401' })
    await addProgress(dir, b.id, '开始查', 'doing')
    const out = await suggest({ cwd: dir, roots: [] })
    assert.equal(out.layer, 'project')
    shapeOk(out)
    assert.equal(out.items[0].kind, 'direction', '项目级先给一条「这条线怎么走」')
    assert.equal(out.items[1].skill, 'correct', '在做中的 bug 排第一')
    assert.equal(out.items[1].cardId, b.id)
    // 命令里必须带卡号，粘回去执行时才知道说的是哪张
    assert.match(out.items[1].prompt, /^\/correct #\d+ 登录后偶发 401/)
    assert.match(out.items[0].prompt, /^\/correct #\d+ /)
    assert.ok(out.items.some((i) => i.cardId === a.id))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('项目层：只有一张卡也补到三条，不然太单薄', async () => {
  const dir = await tmp()
  try {
    await saveCard(dir, { kind: 'idea', title: '把导出改成流式的，别一次读进内存' })
    const out = await suggest({ cwd: dir, roots: [] })
    assert.equal(out.layer, 'project')
    shapeOk(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('全局层：这个项目没卡，去别的项目里找开着的', async () => {
  const root = await tmp()
  const here = join(root, 'empty-proj')
  const other = join(root, 'other-proj')
  await mkdir(here, { recursive: true })
  await mkdir(other, { recursive: true })
  try {
    await saveCard(other, { kind: 'bug', title: '支付回调丢了' })
    const out = await suggest({ cwd: here, roots: [root] })
    assert.equal(out.layer, 'global')
    shapeOk(out)
    assert.equal(out.items[0].project, 'other-proj', '要标出是哪个项目的卡')
    assert.match(out.items[0].prompt, /项目：other-proj/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('开场层：哪儿都没卡，也得给三条能直接发的', async () => {
  const dir = await tmp()
  try {
    const out = await suggest({ cwd: dir, roots: [] })
    assert.equal(out.layer, 'seed')
    shapeOk(out)
    assert.deepEqual(out.items.map((i) => i.skill), ['in-your-own-words', 'figure-it-out', 'poteto-help'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('做完和废弃的卡不再出现在建议里', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '已经做完的事' })
    await addProgress(dir, a.id, '做完了', 'done')
    const out = await suggest({ cwd: dir, roots: [] })
    assert.equal(out.layer, 'seed', '全都关了就该回到开场层')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('noul 层：说不清的卡先别选技能，先去问清', async () => {
  const dir = await tmp()
  try {
    await saveCard(dir, { kind: 'bug', title: '快一点' })
    const out = await suggest({ cwd: dir, roots: [] })
    const first = out.items.find((i) => i.skill === 'in-your-own-words')
    assert.ok(first, '说不清的卡要给澄清建议')
    assert.equal(first.ask, true)
    assert.ok(first.certainty < 0.5, '把握低才叫先确认')
    assert.match(first.prompt, /^\/in-your-own-words #\d+ 快一点/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('score 层：在做的缺陷压过待办的任务，且每条都带紧急度与把握', async () => {
  const dir = await tmp()
  try {
    await saveCard(dir, { kind: 'task', title: '给看板加列筛选和分组' })
    const b = await saveCard(dir, { kind: 'bug', title: '支付回调丢了，订单一直挂着' })
    await addProgress(dir, b.id, '在查日志', 'doing')
    const out = await suggest({ cwd: dir, roots: [] })
    const scored = out.items.filter((i) => i.cardId)
    assert.equal(scored[0].cardId, b.id)
    assert.ok(scored[0].urgency > scored[scored.length - 1].urgency)
    for (const it of scored) {
      assert.equal(typeof it.urgency, 'number')
      assert.equal(typeof it.certainty, 'number')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('coefficients：改一个系数就改优先级，不用动提示词', async () => {
  const { COEF } = await import('../src/suggest.js')
  assert.deepEqual(Object.keys(COEF).sort(), ['fresh', 'kind', 'progress', 'state'])
  const sum = Object.values(COEF).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, '系数要加起来等于 1，才算 0~1 的分数')
})

test('项目级：有依赖的两张卡串成一条线，方向建议看得出先后', async () => {
  const dir = await tmp()
  try {
    const a = await saveCard(dir, { kind: 'task', title: '先把登录 session 换成新的' })
    const b = await saveCard(dir, { kind: 'task', title: '再给 session 加刷新', after: [a.id] })
    const out = await suggest({ cwd: dir, roots: [] })
    const dir0 = out.items[0]
    assert.equal(dir0.kind, 'direction')
    assert.deepEqual(dir0.chain, [a.id, b.id])
    assert.match(dir0.title, /先把登录 session 换成新的 → 再给 session 加刷新/)
    assert.equal(dir0.cardId, a.id, '方向建议也要指明先从哪张卡下手')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('图：节点带深度、边指向后继、废弃的卡不进线里', async () => {
  const { graph } = await import('../src/board.js')
  const cards = [
    { id: 1, title: 'A', kind: 'task', state: 'doing', after: [] },
    { id: 2, title: 'B', kind: 'task', state: 'todo', after: [1] },
    { id: 3, title: 'C', kind: 'task', state: 'dropped', after: [1] },
    { id: 4, title: 'D', kind: 'idea', state: 'idea', after: [] },
    { id: 5, title: '坏引用', kind: 'idea', state: 'idea', after: [99] },
  ]
  const g = graph(cards)
  assert.deepEqual(g.edges, [{ from: 1, to: 2 }, { from: 1, to: 3 }])
  assert.equal(g.nodes.find((n) => n.id === 2).depth, 1)
  assert.equal(g.nodes.find((n) => n.id === 1).depth, 0)
  assert.deepEqual(g.lines.map((l) => l[0]).sort(), [1, 4, 5], '没有未完成前置的才是线的头')
  assert.equal(g.lines.some((l) => l.includes(3)), false, '废弃的卡不该出现在推进的线里')
  assert.equal(g.depthMax, 1)
})
