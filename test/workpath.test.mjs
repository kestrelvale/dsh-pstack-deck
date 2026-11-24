import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { noteReport, readWorkPath, reportPath } from '../src/workpath.js'

const ROOT = '/ws/workpath-test'
const NOW = 1_700_000_000_000
const HOUR = 3600e3
const DAY = 24 * HOUR

async function makeDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-workpath-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('空账本：文件不存在时 missing 为 true，而不是抛错', async (t) => {
  const dir = await makeDir(t)
  const got = await readWorkPath(ROOT, { dir })
  assert.equal(got.missing, true)
  assert.deepEqual(got.entries, [])
  assert.equal(got.scanned, 0)
  assert.equal(got.fresh, 0)
  assert.equal(got.archived, 0)
})

test('记一行再读：能看见 sessionId、cardId、title、state', async (t) => {
  const dir = await makeDir(t)
  await noteReport({ root: ROOT, sessionId: 's1', cardId: '#12', title: '记账', state: 'doing', at: NOW, dir })

  const got = await readWorkPath(ROOT, { now: NOW, dir })
  assert.equal(got.missing, false)
  assert.equal(got.entries.length, 1)
  const [e] = got.entries
  assert.equal(e.sessionId, 's1')
  assert.equal(e.cardId, '#12')
  assert.equal(e.title, '记账')
  assert.equal(e.state, 'doing')
  assert.equal(e.age, 0)
  assert.equal(e.stale, false)
  assert.equal(got.fresh, 1)
})

test('同一会话同一张卡 doing → done：只剩一条，state 是 done', async (t) => {
  const dir = await makeDir(t)
  const base = { root: ROOT, sessionId: 's1', cardId: '#12', title: '记账', dir }
  await noteReport({ ...base, state: 'doing', at: NOW })
  await noteReport({ ...base, state: 'done', at: NOW + 1000 })

  const got = await readWorkPath(ROOT, { now: NOW + 2000, dir })
  assert.equal(got.entries.length, 1)
  assert.equal(got.entries[0].state, 'done')
  assert.equal(got.entries[0].at, NOW + 1000)
})

test('不同会话两张卡：entries 两条，按时间倒序', async (t) => {
  const dir = await makeDir(t)
  await noteReport({ root: ROOT, sessionId: 's1', cardId: '#1', title: '先做的', state: 'doing', at: NOW, dir })
  await noteReport({ root: ROOT, sessionId: 's2', cardId: '#2', title: '后做的', state: 'doing', at: NOW + HOUR, dir })

  const got = await readWorkPath(ROOT, { now: NOW + 2 * HOUR, dir })
  assert.equal(got.entries.length, 2)
  assert.equal(got.entries[0].cardId, '#2')
  assert.equal(got.entries[1].cardId, '#1')
  assert.ok(got.entries[0].at > got.entries[1].at)
})

test('窗口外标 stale：fresh/archived 计数正确，超归档期的留在盘上但不返回', async (t) => {
  const dir = await makeDir(t)
  await noteReport({ root: ROOT, sessionId: 's1', cardId: '#f', title: '新', state: 'doing', at: NOW - HOUR, dir })
  await noteReport({ root: ROOT, sessionId: 's1', cardId: '#a', title: '旧', state: 'done', at: NOW - 2 * DAY, dir })
  await noteReport({ root: ROOT, sessionId: 's1', cardId: '#x', title: '更旧', state: 'done', at: NOW - 8 * DAY, dir })

  const got = await readWorkPath(ROOT, { windowMs: DAY, archiveMs: 7 * DAY, now: NOW, dir })
  assert.equal(got.scanned, 3)
  assert.equal(got.entries.length, 2)
  assert.equal(got.fresh, 1)
  assert.equal(got.archived, 1)
  assert.equal(got.entries[0].cardId, '#f')
  assert.equal(got.entries[0].stale, false)
  assert.equal(got.entries[1].cardId, '#a')
  assert.equal(got.entries[1].stale, true)
  assert.ok(got.entries[1].age >= 2 * DAY)
})

test('坏 JSON：抛 kind 为 parse 的错', async (t) => {
  const dir = await makeDir(t)
  const path = await reportPath(ROOT, { dir })
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '{ 这不是 json', 'utf8')

  await assert.rejects(readWorkPath(ROOT, { dir }), (e) => e.kind === 'parse')
})

test('500 条上限：裁掉最旧的，保留最新的 500 条', async (t) => {
  const dir = await makeDir(t)
  for (let i = 0; i < 505; i++) {
    await noteReport({ root: ROOT, sessionId: 's1', cardId: `#${i}`, title: `卡 ${i}`, state: 'doing', at: NOW + i, dir })
  }

  const got = await readWorkPath(ROOT, { now: NOW + 1000, dir })
  assert.equal(got.scanned, 500)
  assert.equal(got.entries.length, 500)
  const ids = new Set(got.entries.map((e) => e.cardId))
  assert.equal(ids.has('#0'), false)
  assert.equal(ids.has('#4'), false)
  assert.equal(ids.has('#5'), true)
  assert.equal(ids.has('#504'), true)
})

test('文件超过 200KB：从最旧的裁，裁完仍是合法 JSON', async (t) => {
  const dir = await makeDir(t)
  const title = '长'.repeat(4000) // 约 12KB/条
  for (let i = 0; i < 30; i++) {
    await noteReport({ root: ROOT, sessionId: 's1', cardId: `#${i}`, title, state: 'doing', at: NOW + i, dir })
  }

  const path = await reportPath(ROOT, { dir })
  const raw = await readFile(path, 'utf8')
  assert.ok(Buffer.byteLength(raw, 'utf8') <= 200 * 1024)
  const data = JSON.parse(raw)
  assert.equal(data.version, 1)
  assert.equal(data.root, ROOT)
  assert.equal(data.entries.some((e) => e.cardId === '#0'), false)
  assert.equal(data.entries.some((e) => e.cardId === '#29'), true)
})

test('同一状态重复上报：不写第二份，mtime 不变', async (t) => {
  const dir = await makeDir(t)
  const base = { root: ROOT, sessionId: 's1', cardId: '#12', title: '记账', state: 'doing', dir }
  await noteReport({ ...base, at: NOW })
  const path = await reportPath(ROOT, { dir })
  const before = await stat(path)
  const beforeText = await readFile(path, 'utf8')

  await noteReport({ ...base, at: NOW + 5000 })

  const after = await stat(path)
  const afterText = await readFile(path, 'utf8')
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(afterText, beforeText)
  const got = await readWorkPath(ROOT, { now: NOW + 6000, dir })
  assert.equal(got.entries.length, 1)
  assert.equal(got.entries[0].at, NOW)
})