// 看板 = markdown + git。这里钉住四件事：看得见改动、提交得了、凭票才推、失败能归因。
// 所有仓库都在 mkdtemp 里现建，user.name / user.email 一律写本地 config，不碰全局。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { changes, classifyFailure, commit, gitRun, sync } from '../src/git.js'
import { fingerprintOf, makeTicket } from '../src/ticket.js'

const tmp = () => mkdtemp(join(tmpdir(), 'psp-git-'))

async function initRepo() {
  const dir = await tmp()
  assert.equal((await gitRun(dir, ['init', '-q', '-b', 'main'])).ok, true)
  assert.equal((await gitRun(dir, ['config', 'user.email', 'test@example.com'])).ok, true)
  assert.equal((await gitRun(dir, ['config', 'user.name', '看板测试'])).ok, true)
  return dir
}

async function withRepo(fn) {
  const dir = await initRepo()
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('changes 看得到未跟踪文件（??），分支名也对', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    const st = await changes(dir)
    assert.equal(st.ok, true)
    assert.equal(st.branch, 'main')
    assert.equal(st.clean, false)
    const file = st.files.find((f) => f.path === 'board.md')
    assert.deepEqual(file, { path: 'board.md', status: '??', staged: false })
  })
})

test('commit 成功且 hash 非空；再改文件，状态是 M', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    const done = await commit(dir, { message: '第一版\n细节放正文' })
    assert.equal(done.ok, true)
    assert.match(done.hash, /^[0-9a-f]{40}$/)
    assert.equal(done.summary, '第一版')

    const clean = await changes(dir)
    assert.equal(clean.clean, true)

    await writeFile(join(dir, 'board.md'), '# 板子 v2\n')
    const dirty = await changes(dir)
    const file = dirty.files.find((f) => f.path === 'board.md')
    assert.equal(file.status, 'M')
    assert.equal(file.staged, false)
  })
})

test('不是 git 仓库：changes 归到 env', async () => {
  const dir = await tmp()
  try {
    await assert.rejects(
      changes(dir),
      (e) => e.kind === 'env' && /不是 git 仓库/.test(e.message),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('空 message 被拒，盘上一个字节没动', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    await assert.rejects(
      commit(dir, { message: '   ' }),
      (e) => e.kind === 'unsupported' && /提交信息不能为空/.test(e.message),
    )
    const st = await changes(dir)
    assert.equal(st.files[0].status, '??')
  })
})

test('sync 不带票被拒', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    await commit(dir, { message: '第一版' })
    await assert.rejects(
      sync(dir, { push: true }),
      (e) => e.kind === 'unsupported' && /需要一张票/.test(e.message),
    )
  })
})

test('sync 带票但指纹不符被拒', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    await commit(dir, { message: '第一版' })
    await writeFile(join(dir, 'board.md'), '# 板子 v2\n')

    const ticket = makeTicket({
      op: 'push',
      target: 'origin',
      fingerprint: fingerprintOf([{ path: 'board.md', status: 'M', staged: false }]),
    })
    // 现场此时是多了一个未跟踪文件的另一份盘面，和票上记的不一样。
    await writeFile(join(dir, 'other.md'), '别的东西\n')
    await assert.rejects(
      sync(dir, { push: true, ticket }),
      (e) => e.kind === 'conflict' && /现场/.test(e.message),
    )
  })
})

test('凭票 push 到本地裸仓：第一次推了，第二次 up-to-date', async () => {
  const dir = await initRepo()
  const bare = await tmp()
  try {
    assert.equal((await gitRun(bare, ['init', '-q', '--bare'])).ok, true)
    await writeFile(join(dir, 'board.md'), '# 板子\n')
    const first = await commit(dir, { message: '第一版' })
    assert.equal((await gitRun(dir, ['remote', 'add', 'origin', bare])).ok, true)
    assert.equal((await gitRun(dir, ['push', '-u', 'origin', 'main'])).ok, true)

    await writeFile(join(dir, 'board.md'), '# 板子 v2\n')
    const second = await commit(dir, { message: '第二版' })

    const st = await changes(dir)
    const ticket = makeTicket({
      op: 'push',
      target: 'origin',
      fingerprint: fingerprintOf(st.files),
    })
    assert.deepEqual(await sync(dir, { push: true, ticket }), { ok: true, pushed: true })
    const remote = await gitRun(bare, ['rev-parse', 'main'])
    assert.equal(remote.stdout.trim(), second.hash)
    assert.notEqual(second.hash, first.hash)

    // 再推一次没有新东西：同一个票仍然对得上现场（files 是空的）。
    assert.deepEqual(await sync(dir, { push: true, ticket }), { ok: true, pushed: false })
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(bare, { recursive: true, force: true })
  }
})

test('classifyFailure 六种样例各归各类', () => {
  const cases = [
    ['changes', { ok: false, code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' }, 'env'],
    ['commit', { ok: false, code: 1, stderr: 'nothing to commit, working tree clean' }, 'unsupported'],
    ['commit', { ok: false, code: 128, stderr: "fatal: Unable to create '/tmp/x/.git/index.lock': File exists.\nAnother git process seems to be running" }, 'conflict'],
    ['push', { ok: false, code: 1, stderr: ' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs' }, 'conflict'],
    ['push', { ok: false, code: 128, stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }, 'auth'],
    ['push', { ok: false, code: null, stderr: '' }, 'network'],
  ]
  for (const [stage, res, kind] of cases) {
    const got = classifyFailure(stage, res)
    assert.equal(got.kind, kind, `${stage} / ${res.stderr || '空 stderr'}`)
    assert.match(got.message, /[\u4e00-\u9fa5]/, 'message 要是中文人话')
    assert.match(got.hint, /[\u4e00-\u9fa5]/, 'hint 要说下一步')
  }
  assert.equal(classifyFailure('push', { code: 2, stderr: 'some odd failure' }).kind, 'unknown')
})