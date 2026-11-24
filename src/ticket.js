// dsh-pstack-deck · 凭票提交
//
// 板子是 markdown + git：AI 不能凭一句话就改板子，得先拿一张票。
// 票不证明「你有权」，只证明「你看过现场」——票里锁着 fingerprint，
// 现场一变（文件列表变了）票就作废，调用方必须重新看一遍再取票。

import { createHash } from 'node:crypto'

import { failAs } from './errors.js'

const sha16 = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)

/** 稳定序列化：对象键排序、数组保序，同样的内容永远得到同样的串。 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key])
    return out
  }
  return value
}

/** 现场指纹：sha256(稳定序列化) 前 16 位。只用来比「还是不是刚才那份」，不做鉴权。 */
export function fingerprintOf(value) {
  return sha16(JSON.stringify(stable(value)) ?? 'undefined')
}

/** 发一张票。token 把 op / target / fingerprint / issuedAt 一起锁死，手改任何一格都对不上。 */
export function makeTicket({ op, target, fingerprint, ttlMs = 120000, now = Date.now() }) {
  const issuedAt = now
  return {
    op,
    target,
    fingerprint,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    token: fingerprintOf({ op, target, fingerprint, issuedAt }),
  }
}

/**
 * 验票：缺票、过期、token 对不上、现场指纹变了，都不放行。
 * 通过返回 true；不通过抛 failAs，让调用方把「为什么」原样带给面板。
 */
export function verifyTicket(ticket, actual, { now = Date.now() } = {}) {
  if (!ticket || typeof ticket !== 'object') {
    throw failAs(
      'unsupported',
      '这一步需要一张票，但没给票：先看一眼现场，再凭票动手',
      '用 changes 看现场，再用 makeTicket 取票，别绕过票直接提交',
    )
  }
  if (!Number.isFinite(ticket.expiresAt) || now >= ticket.expiresAt) {
    throw failAs(
      'conflict',
      '这张票过期了：当时看到的现场已经不算数',
      '重新看一遍 changes，确认现在是什么样，再取一张新票',
    )
  }
  const expected = fingerprintOf({
    op: ticket.op,
    target: ticket.target,
    fingerprint: ticket.fingerprint,
    issuedAt: ticket.issuedAt,
  })
  if (ticket.token !== expected) {
    throw failAs(
      'conflict',
      '票的 token 对不上：票被改过，不是发出来的那张',
      '票只能由 makeTicket 发；重新取一张，别手改 token',
    )
  }
  if (typeof actual?.fingerprint !== 'string' || actual.fingerprint !== ticket.fingerprint) {
    throw failAs(
      'conflict',
      '现场和票上记的不一样：你看到之后文件已经变了',
      '重新 changes 看清盘上现在是什么样，再取一张新票',
    )
  }
  return true
}