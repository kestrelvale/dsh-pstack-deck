// 环境自检的三条底线：
// 1. 每一项都有状态，非 ok 的必须带一句「怎么补」——用户要的是恢复办法，不是红叉；
// 2. 断网不能报成「插件有病」：版本那条退成 skip；
// 3. 项目没初始化时，指清楚点哪里，而不是只说「缺 board」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkEnv } from '../src/env.js'

const offline = async () => ({ current: '0.0.0', latest: '', hasUpdate: false, cached: false, error: 'offline' })
const STATES = ['ok', 'warn', 'fail', 'skip']

test('环境自检：六项齐全，每一项都有状态，非 ok 的都写着怎么补', async () => {
  const out = await checkEnv({ cwd: process.cwd(), updater: offline })
  assert.deepEqual(out.rows.map((r) => r.key), ['skills', 'zh', 'deps', 'installed', 'board', 'version'])
  for (const r of out.rows) {
    assert.ok(STATES.includes(r.state), r.key + ' 状态不合法：' + r.state)
    assert.ok(r.label && r.detail, r.key + ' 少了标题或说明')
    if (r.state !== 'ok') assert.ok(String(r.hint || '').trim(), r.key + ' 不是 ok 却没写怎么补')
  }
  // 这个仓库里技能一定读得到——读不到说明包本身就坏了
  assert.equal(out.rows.find((r) => r.key === 'skills').state, 'ok')
  const zh = out.rows.find((r) => r.key === 'zh')
  assert.match(zh.detail, /\/\s*\d+ 份/)
  assert.ok(['ok', 'warn', 'skip'].includes(zh.state))
})

test('环境自检：项目没初始化 → 说要补，并且指到看板页的初始化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psp-env-'))
  try {
    const out = await checkEnv({ cwd: dir, updater: offline })
    const board = out.rows.find((r) => r.key === 'board')
    assert.equal(board.state, 'warn')
    assert.match(board.detail, /没有看板/)
    assert.match(board.hint, /看板/)
    assert.equal(out.project.initialized, false)
    // 断网只该是「没查」，不该是「坏了」
    assert.equal(out.rows.find((r) => r.key === 'version').state, 'skip')
    assert.equal(out.health, 'warn')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('环境自检：有新版就说有新版，新版号要出现在说明里', async () => {
  const out = await checkEnv({
    updater: async () => ({ current: '0.1.0', latest: '9.9.9', hasUpdate: true, cached: false, error: '' }),
  })
  const ver = out.rows.find((r) => r.key === 'version')
  assert.equal(ver.state, 'warn')
  assert.match(ver.detail, /9\.9\.9/)
  assert.match(ver.hint, /重启/)
})