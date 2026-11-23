// 版本比较与「问 npm 有没有新版」。
// 这里钉两件事：数字比较别被字符串坑；查不到时要说明查不到，不能装作最新。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkUpdate, newer, parseVersion } from '../src/update.js'

test('版本号解析：正式版与预发布', () => {
  assert.deepEqual(parseVersion('0.1.0'), { num: [0, 1, 0], pre: '' })
  assert.deepEqual(parseVersion('v1.2.3'), { num: [1, 2, 3], pre: '' })
  assert.deepEqual(parseVersion('0.2.0-beta.3'), { num: [0, 2, 0], pre: 'beta.3' })
  assert.equal(parseVersion('latest'), null)
})

test('谁更新：按数字比，不按字符串比', () => {
  assert.equal(newer('0.1.1', '0.1.0'), true)
  assert.equal(newer('0.10.0', '0.9.0'), true, '字符串比会在这里错')
  assert.equal(newer('1.0.0', '0.99.99'), true)
  assert.equal(newer('0.1.0', '0.1.0'), false)
  assert.equal(newer('0.1.0', '0.1.1'), false)
  assert.equal(newer('0.2.0-beta.1', '0.2.0'), false, '预发布比同号正式版旧')
  assert.equal(newer('0.2.0', '0.2.0-beta.1'), true)
  assert.equal(newer('garbage', '0.1.0'), false, '解析不了就当没更新')
})

const fakeRes = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

test('问 npm：有新版、没新版、连不上三种答案', async () => {
  const up = await checkUpdate({ current: '0.1.0', fetcher: async () => fakeRes({ 'dist-tags': { latest: '0.2.0' } }) })
  assert.equal(up.hasUpdate, true)
  assert.equal(up.latest, '0.2.0')
  assert.equal(up.error, '')

  const same = await checkUpdate({ current: '0.2.0', fetcher: async () => fakeRes({ 'dist-tags': { latest: '0.2.0' } }) })
  assert.equal(same.hasUpdate, false)

  const down = await checkUpdate({ current: '0.1.0', useCache: false, fetcher: async () => { throw new Error('offline') } })
  assert.equal(down.hasUpdate, false)
  assert.match(down.error, /offline/)
})

test('十分钟内不重复打 npm，除非要求 fresh', async () => {
  let hits = 0
  const fetcher = async () => { hits += 1; return fakeRes({ 'dist-tags': { latest: '9.9.9' } }) }
  // 别的用例可能已经把缓存填了，这里先强制重问一次把缓存踩成自己的时间点
  const first = await checkUpdate({ current: '0.1.0', fetcher, now: 1_000_000, useCache: false })
  assert.equal(first.cached, false)
  const second = await checkUpdate({ current: '0.1.0', fetcher, now: 1_000_000 + 60_000 })
  assert.equal(second.cached, true)
  assert.equal(hits, 1)
  await checkUpdate({ current: '0.1.0', fetcher, now: 1_000_000 + 60_000, useCache: false })
  assert.equal(hits, 2)
})
