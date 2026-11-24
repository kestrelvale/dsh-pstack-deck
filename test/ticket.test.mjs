// 票只证明「你看过现场」：指纹确定性、过期、靶子变了、token 被改，一条一条钉住。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fingerprintOf, makeTicket, verifyTicket } from '../src/ticket.js'

test('指纹是确定的：同对象不同键序同指纹，数组顺序变了就不同', () => {
  const a = fingerprintOf({ b: 2, a: 1, nested: { d: 4, c: 3 } })
  const b = fingerprintOf({ nested: { c: 3, d: 4 }, a: 1, b: 2 })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{16}$/)
  assert.notEqual(fingerprintOf([1, 2]), fingerprintOf([2, 1]))
  assert.equal(fingerprintOf([{ y: 2, x: 1 }]), fingerprintOf([{ x: 1, y: 2 }]))
})

test('正常票通过', () => {
  const fp = fingerprintOf([{ path: 'board/a.md', status: 'M', staged: false }])
  const ticket = makeTicket({ op: 'push', target: 'origin', fingerprint: fp, ttlMs: 60000, now: 1000 })
  assert.equal(ticket.issuedAt, 1000)
  assert.equal(ticket.expiresAt, 61000)
  assert.equal(verifyTicket(ticket, { fingerprint: fp }, { now: 2000 }), true)
})

test('票过期被拒，kind 是 conflict', () => {
  const fp = fingerprintOf(['现场'])
  const ticket = makeTicket({ op: 'push', target: 'origin', fingerprint: fp, ttlMs: 1000, now: 1000 })
  assert.throws(
    () => verifyTicket(ticket, { fingerprint: fp }, { now: 2001 }),
    (e) => e.kind === 'conflict' && /过期/.test(e.message),
  )
})

test('靶子变了（指纹不同）被拒，kind 是 conflict', () => {
  const ticket = makeTicket({
    op: 'push',
    target: 'origin',
    fingerprint: fingerprintOf([{ path: 'board/a.md', status: 'M', staged: false }]),
    now: 1000,
  })
  assert.throws(
    () => verifyTicket(ticket, { fingerprint: fingerprintOf([{ path: 'board/a.md', status: '??', staged: false }]) }, { now: 2000 }),
    (e) => e.kind === 'conflict' && /现场/.test(e.message),
  )
})

test('token 被改被拒，kind 是 conflict', () => {
  const fp = fingerprintOf(['现场'])
  const ticket = makeTicket({ op: 'push', target: 'origin', fingerprint: fp, now: 1000 })
  const forged = { ...ticket, token: fingerprintOf('我自己签的') }
  assert.throws(
    () => verifyTicket(forged, { fingerprint: fp }, { now: 2000 }),
    (e) => e.kind === 'conflict' && /token/.test(e.message),
  )
})

test('没给票直接拒绝，kind 是 unsupported', () => {
  assert.throws(
    () => verifyTicket(undefined, { fingerprint: fingerprintOf([]) }),
    (e) => e.kind === 'unsupported' && /需要一张票/.test(e.message),
  )
})