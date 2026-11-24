// 环境链的判据一次钉死：「现在能点哪一个、点不了的被谁挡住、还是根本点不动」。
// 顺带把动作契约也钉住——面板靠它决定画不画按钮。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CHAIN_STATES, evaluateChain } from '../src/env-chain.js'
import { ACTIONS, isAction, labelOf, normalizeAction } from '../src/env-fix.js'

const item = (id, ok, actions) =>
  actions === undefined ? { id, label: id, ok } : { id, label: id, ok, actions }

test('第一项过了、第二项失败但有动作：第二项是链头，第三项排队且指出被谁挡住', () => {
  const r = evaluateChain([
    item('a', true),
    item('b', false, [{ type: 'rpc' }]),
    item('c', false, [{ type: 'refresh' }]),
  ])
  assert.equal(r.head, 'b')
  assert.deepEqual(
    r.items.map((it) => it.chain),
    ['done', 'current', 'pending'],
  )
  assert.equal(r.items[0].blockedBy, undefined)
  assert.equal(r.items[2].blockedBy, 'b')
  assert.deepEqual(CHAIN_STATES, ['done', 'current', 'fail', 'pending'])
})

test('链头没有任何动作：标 fail，不许画成能点的', () => {
  const noField = evaluateChain([item('a', true), item('b', false)])
  assert.equal(noField.head, 'b')
  assert.deepEqual(
    noField.items.map((it) => it.chain),
    ['done', 'fail'],
  )

  const emptyList = evaluateChain([item('a', false, [])])
  assert.equal(emptyList.items[0].chain, 'fail')
})

test('全 ok：没有链头，每一项都是 done', () => {
  const r = evaluateChain([item('a', true), item('b', true)])
  assert.equal(r.head, null)
  assert.deepEqual(
    r.items.map((it) => it.chain),
    ['done', 'done'],
  )
})

test('空表：原样返回空链', () => {
  assert.deepEqual(evaluateChain([]), { head: null, items: [] })
})

test('normalizeAction 拒未知 type，kind 是 unsupported；合法动作返回独立副本', () => {
  assert.ok(ACTIONS.includes('wizard'), 'wizard 要登记进白名单，哪怕只给文案')
  assert.throws(
    () => normalizeAction({ type: 'launch-rocket' }),
    (e) => e.kind === 'unsupported' && /launch-rocket/.test(e.message),
  )
  assert.throws(
    () => normalizeAction({ type: 'LAUNCH' }),
    (e) => e.kind === 'unsupported',
  )

  const src = { type: 'rpc', payload: 1 }
  const copy = normalizeAction(src)
  assert.deepEqual(copy, { type: 'rpc', payload: 1 })
  assert.notEqual(copy, src, '要复制，不能把调用方那份改掉')
})

test('按钮文案：三种默认 + 自定义 label 优先', () => {
  assert.equal(labelOf({ type: 'refresh' }), '重新检测')
  assert.equal(labelOf({ type: 'rpc' }), '现在初始化')
  assert.equal(labelOf({ type: 'wizard' }), '开始引导')
  assert.equal(labelOf({ type: 'open-url' }, '看板说明'), '打开看板说明')
  assert.equal(
    labelOf({ type: 'inject-prompt', label: '把这张卡的说明补上' }),
    '把这张卡的说明补上',
  )
})

test('isAction 只认白名单里的 type，垃圾数据不抛错', () => {
  assert.equal(isAction({ type: 'refresh' }), true)
  assert.equal(isAction({ type: 'launch-rocket' }), false)
  assert.equal(isAction(null), false)
  assert.equal(isAction('refresh'), false)
})