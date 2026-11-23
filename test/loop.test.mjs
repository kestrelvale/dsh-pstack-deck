// 闭环：认领 → 干活 → done/drop（必须带结论）→ 必要时重开。
// 这层坏掉的症状很具体：卡永远停在「在做」、 deserted 的卡再也回不来、
// 地图上的「已经定了」永远是空的——所以这里每一条都对着一个症状。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  answerOf, appendToSection, claimCard, finishCard, loadBoard, mapSections, reopenCard, saveCard,
} from '../src/board.js'

const tmp = () => mkdtemp(join(tmpdir(), 'pstack-loop-'))

test('收尾必须有结论：空 note 直接拒，状态一个字都不改', async () => {
  const dir = await tmp()
  try {
    const card = await saveCard(dir, { kind: 'task', title: '把导出改成流式的', state: 'doing', owner: 'me' })
    await assert.rejects(() => finishCard(dir, card.id, { state: 'done' }), /结论/)
    await assert.rejects(() => finishCard(dir, card.id, { state: 'dropped', note: '   ' }), /原因/)
    await assert.rejects(() => finishCard(dir, card.id, { state: 'doing', note: 'x' }), /done 或 dropped/)
    const board = await loadBoard(dir)
    assert.equal(board.cards[0].state, 'doing')
    assert.equal(board.cards[0].owner, 'me')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('done：状态落盘、认领人清空、结论进卡、地图「已经定了」记一笔', async () => {
  const dir = await tmp()
  try {
    const map = await saveCard(dir, { kind: 'map', title: '这次要去哪' })
    const card = await saveCard(dir, { kind: 'task', title: '换掉 session 写法', state: 'doing', owner: 'me', parent: map.id })
    const done = await finishCard(dir, card.id, { state: 'done', note: '换完了，跑过 52 个测试' })

    assert.equal(done.state, 'done')
    assert.equal(done.owner, undefined, '做完要把认领人放开，否则别人以为还占着')
    assert.equal(answerOf(done), '换完了，跑过 52 个测试')
    assert.match(done.body, /^- \d{4}-\d{2}-\d{2} \[完成\] 换完了/m)

    const board = await loadBoard(dir)
    const sections = mapSections(board.cards.find((c) => c.id === map.id))
    assert.match(sections.decisions, new RegExp(`#${card.id} 换掉 session 写法 —— 换完了`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('drop：写进地图「不做什么」，卡留着，能重开', async () => {
  const dir = await tmp()
  try {
    const map = await saveCard(dir, { kind: 'map', title: '这次要去哪' })
    const card = await saveCard(dir, { kind: 'idea', title: '把导出挪到 worker', state: 'doing', owner: 'me', parent: map.id })
    const dropped = await finishCard(dir, card.id, { state: 'dropped', note: '浏览器不支持，换 streaming 方案' })
    assert.equal(dropped.state, 'dropped')

    const board = await loadBoard(dir)
    assert.equal(board.cards.length, 2, '废弃不是删除')
    assert.match(mapSections(board.cards.find((c) => c.id === map.id)).out, /放掉了：浏览器不支持/)

    const reopened = await reopenCard(dir, card.id, { note: 'streaming 方案能走' })
    assert.equal(reopened.state, 'todo')
    assert.equal(reopened.owner, undefined)
    assert.match(reopened.body, /重开：streaming 方案能走/)
    // 重开之后还能再走一遍闭环
    const again = await finishCard(dir, card.id, { state: 'done', note: '这次成了' })
    assert.equal(again.state, 'done')
    assert.match(answerOf(again), /浏览器不支持[\s\S]*这次成了/, '结论是累加的，不是覆盖')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('claim：被挡着不能认领，做完的不能认领，别人认了的不能抢', async () => {
  const dir = await tmp()
  try {
    const first = await saveCard(dir, { kind: 'task', title: '先把数据层定下来' })
    const second = await saveCard(dir, { kind: 'task', title: '再改接口', after: [first.id] })

    await assert.rejects(() => claimCard(dir, second.id, { owner: 'me' }), /还被挡着/)

    const mine = await claimCard(dir, first.id, { owner: 'me', scope: ['src/db'] })
    assert.equal(mine.state, 'doing')
    assert.equal(mine.owner, 'me')
    assert.deepEqual(mine.scope, ['src/db'])
    await assert.rejects(() => claimCard(dir, first.id, { owner: 'B' }), /已经被 me 认领/)

    await finishCard(dir, first.id, { state: 'done', note: '数据层定了' })
    await assert.rejects(() => claimCard(dir, first.id, { owner: 'me' }), /先 reopen/)
    // 前置做完了，后一张自动解锁
    const unlocked = await claimCard(dir, second.id, { owner: 'me' })
    assert.equal(unlocked.state, 'doing')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('map 卡不能被标成完成；文件仍然是可读的 markdown', async () => {
  const dir = await tmp()
  try {
    const map = await saveCard(dir, { kind: 'map', title: '这次要去哪' })
    await assert.rejects(() => finishCard(dir, map.id, { state: 'done', note: 'x' }), /地图不是活/)
    const card = await saveCard(dir, { kind: 'bug', title: '偶发 401' })
    await finishCard(dir, card.id, { state: 'done', note: '加了重试' })
    const files = await readdir(join(dir, '.pstack', 'board'))
    const raw = await readFile(join(dir, '.pstack', 'board', files.find((f) => f.startsWith(`${card.id}-`))), 'utf8')
    assert.match(raw, /^state: done$/m)
    assert.match(raw, /^## 结论$/m)
    assert.match(raw, /加了重试/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('appendToSection：段不存在就补，存在就接在末尾，不碰别的段', () => {
  const body = '## 去向\n要做完\n\n## 已经定了\n- 甲\n\n## 不做什么\n- 乙\n'
  const out = appendToSection(body, '已经定了', '- 丙')
  assert.match(out, /## 已经定了\n- 甲\n- 丙\n\n## 不做什么/)
  const added = appendToSection(body, '还没想清', '- 丁')
  assert.match(added, /## 还没想清\n\n- 丁/)
  assert.match(added, /## 不做什么\n- 乙/, '原有段不能被吃掉')
  assert.equal(answerOf({ body: 'no head' }), '')
  assert.equal(answerOf({ body: '## 结论\n做了 A\n\n## 别的\n不管' }), '做了 A')
})
