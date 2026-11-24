// 写路径的事务性：排队、版本闸、原子落盘、写后回读。
// 这些是「人手上改过的东西不该被自动写抹掉」的地基，所以每条都对着一个具体的坏法。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FILE_CAP, mtimeOf, rewriteText, writeNew } from '../src/write.js'

const tmp = () => mkdtemp(join(tmpdir(), 'psp-write-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('同一个文件的写排队：三个写不互相覆盖，也不留 tmp', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'a', 'utf8')
    await Promise.all(
      [1, 2, 3].map((n) =>
        rewriteText(path, async (before) => {
          await sleep(5) // 故意在写里等一会儿：不排队的话后一个会读到旧底稿
          return String(before) + n
        }),
      ),
    )
    assert.equal(await readFile(path, 'utf8'), 'a123')
    assert.deepEqual(await readdir(dir), ['a.md'], 'tmp 文件不许留下来')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('外部改过就拒写：报 conflict，盘上一个字节都没变', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'old', 'utf8')
    const at = await mtimeOf(path)
    await sleep(20)
    await writeFile(path, 'human edit', 'utf8') // 人在编辑器里保存了一次
    const err = await rewriteText(path, () => 'automated', { expectedUpdatedAt: at }).then(
      () => null,
      (e) => e,
    )
    assert.equal(err?.kind, 'conflict')
    assert.match(err.message, /一个字都没写/)
    assert.ok(err.hint, '要告诉人下一步做什么')
    assert.equal(await readFile(path, 'utf8'), 'human edit')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('没变就不写：返回 noop，mtime 不动', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'same', 'utf8')
    const before = await mtimeOf(path)
    await sleep(20)
    const r = await rewriteText(path, (t) => t)
    assert.deepEqual([r.written, r.reason, r.text], [false, 'noop', 'same'])
    assert.equal(await mtimeOf(path), before, '没变还去碰文件，等于骗人')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('写后回读：交回的是盘上现在的内容', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'old', 'utf8')
    const r = await rewriteText(path, () => 'new')
    assert.deepEqual([r.written, r.reason, r.text], [true, 'edited', 'new'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('新建不覆盖已有的：报 conflict，老内容还在', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'mine', 'utf8')
    const err = await writeNew(path, 'theirs').then(
      () => null,
      (e) => e,
    )
    assert.equal(err?.kind, 'conflict')
    assert.equal(await readFile(path, 'utf8'), 'mine')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('超过上限拒写：卡不是文件夹，超了让人拆', async () => {
  const dir = await tmp()
  try {
    const path = join(dir, 'a.md')
    await writeFile(path, 'x', 'utf8')
    const big = 'y'.repeat(FILE_CAP + 10)
    const err = await rewriteText(path, () => big).then(
      () => null,
      (e) => e,
    )
    assert.equal(err?.kind, 'conflict')
    assert.match(err.message, /KB/)
    assert.equal(await readFile(path, 'utf8'), 'x')
    assert.deepEqual(await readdir(dir), ['a.md'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})