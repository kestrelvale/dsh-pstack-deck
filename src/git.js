// dsh-pstack-deck · git 就是板子的存档
//
// 面板要能看改动、提交、推送，但每次失败都得一句话归因：
// 是没仓库、没东西可提交、被锁、分叉、没凭据，还是网断了。
// 归因只做一件事——让人知道下一步动哪里；所以每条都带中文 hint。

import { execFile } from 'node:child_process'

import { failAs } from './errors.js'
import { fingerprintOf, verifyTicket } from './ticket.js'

const MAX_OUT = 4 * 1024 * 1024

/**
 * 跑一次 git，不抛错：失败也把 code / stderr 原样带回来，好归因。
 * 超时（timeoutMs）后子进程被杀：code 为 null、stderr 为空。
 */
export async function gitRun(root, args, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: MAX_OUT,
        encoding: 'utf8',
        windowsHide: true,
        // 固定英文报错好归类；不给 git 弹凭据提示的机会，否则面板会一直挂住。
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
        const timedOut = Boolean(err && (err.killed || err.signal)) && code === null
        resolve({
          ok: !err,
          code,
          stdout: String(stdout ?? ''),
          stderr: timedOut ? '' : String(stderr ?? ''),
          argv0: 'git',
        })
      },
    )
  })
}

/**
 * 让 git 的失败变成能跨边界传的 failAs。
 * errors.js 的词表里没有 auth / network 两色，落到边界时归到最近的 permission / env；
 * classifyFailure 仍然如实报 auth / network，供面板显示。
 */
function failOf(stage, res) {
  const f = classifyFailure(stage, res)
  const kind = f.kind === 'auth' ? 'permission' : f.kind === 'network' ? 'env' : f.kind
  return failAs(kind, f.message, f.hint)
}

/** 把 (code, stderr) 归成一个 kind + 中文说明 + 下一步。stage 只是调用点，归因看的是 stderr。 */
export function classifyFailure(stage, res) {
  const stderr = String(res?.stderr ?? '')
  const code = res?.code ?? null
  const raw = stderr.trim().split('\n')[0]

  if (/not a git repository|不是 git 仓库/i.test(stderr)) {
    return {
      kind: 'env',
      message: '这个目录不是 git 仓库，看不到也改不了版本',
      hint: 'git init 之后再提交',
    }
  }
  if (/index\.lock|Another git process seems to be running/i.test(stderr)) {
    return {
      kind: 'conflict',
      message: '另一个 git 进程正占着这个仓库（index.lock 还在）',
      hint: '等它跑完；确认没有 git 在跑之后，删掉 .git/index.lock 再试',
    }
  }
  if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(stderr)) {
    return {
      kind: 'unsupported',
      message: '没有可提交的改动，这次提交不会产生版本',
      hint: '先改点东西，再看 changes 确认真的有改动',
    }
  }
  if (/\[rejected\]|non-fast-forward|failed to push some refs|updates were rejected/i.test(stderr)) {
    return {
      kind: 'conflict',
      message: '远端不收这次推送：你的分支和远端已经分叉',
      hint: '先 git pull --rebase 接上远端改动再推；这里永远不会替你 --force',
    }
  }
  if (/could not read Username|terminal prompts disabled|Authentication failed|Permission denied \(publickey\)|invalid username or password|\/auth/i.test(stderr)) {
    return {
      kind: 'auth',
      message: '推不上去：这台机器没有这个远端的凭据',
      hint: '先在终端里配好 SSH key 或 git 凭据，再重试',
    }
  }
  if (code === null || /Could not resolve host|unable to access|Connection refused|Connection timed out|Network is unreachable|Failed to connect|Recv failure/i.test(stderr)) {
    return {
      kind: 'network',
      message: '连不上 git：超时，或者网络 / DNS 不通',
      hint: '检查网络和远端地址，稍等一会儿再试，别反复刷',
    }
  }
  return {
    kind: 'unknown',
    message: raw ? `git 报了没归类的失败：${raw}` : 'git 失败，但没给出原因',
    hint: `${stage} 这一步没成：看 stderr 原文，或先在终端里手动跑一遍同样的命令`,
  }
}

function parsePorcelain(stdout) {
  const files = []
  const fields = stdout.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i]
    if (!entry) continue
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    const staged = xy[0] !== ' ' && xy[0] !== '?'
    const status = xy === '??' ? '??' : xy[0] !== ' ' ? xy[0] : xy[1]
    // -z 的重命名 / 复制会再跟一个「原路径」字段，这里只要新路径。
    if (xy[0] === 'R' || xy[0] === 'C') i += 1
    if (path) files.push({ path, status, staged })
  }
  return files
}

/** 看现场：当前分支 + 每个改动。没改动就是 clean。 */
export async function changes(root) {
  const status = await gitRun(root, ['status', '--porcelain=v1', '-z'])
  if (!status.ok) throw failOf('changes', status)

  let branch = ''
  const ref = await gitRun(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (ref.ok) {
    branch = ref.stdout.trim()
  } else {
    // 空仓库还没有 HEAD：rev-parse 会失败但 stdout 是 HEAD，用 symbolic-ref 拿真分支名。
    const sym = await gitRun(root, ['symbolic-ref', '--short', 'HEAD'])
    branch = sym.ok && sym.stdout.trim() ? sym.stdout.trim() : 'HEAD'
  }

  const files = parsePorcelain(status.stdout)
  return { ok: true, branch, clean: files.length === 0, files }
}

/**
 * 提交。message 是必填的人话；paths 空 = 全部改动，给了就只 add 这些路径。
 * 成功返回 hash 和第一行摘要，面板直接拿它显示「提交了哪一笔」。
 */
export async function commit(root, { message, paths } = {}) {
  const text = String(message ?? '').trim()
  if (!text) {
    throw failAs(
      'unsupported',
      '提交信息不能为空：没有信息，过几天没人知道这笔改了什么',
      '写一句「改了什么」再提交',
    )
  }

  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : []
  const add = list.length ? await gitRun(root, ['add', '--', ...list]) : await gitRun(root, ['add', '-A'])
  if (!add.ok) throw failOf('commit', add)

  const done = await gitRun(root, ['commit', '-m', text])
  if (!done.ok) throw failOf('commit', done)

  const head = await gitRun(root, ['rev-parse', 'HEAD'])
  if (!head.ok) throw failOf('commit', head)
  return {
    ok: true,
    hash: head.stdout.trim(),
    summary: text.split('\n')[0].trim(),
  }
}

/**
 * 同步。push 必须带一张票：票里锁着 changes 的 files 指纹，现场变了就推不出去。
 * 永远不加 --force；detached HEAD 直接拒绝——推一个没有分支名的 HEAD 没人接得住。
 */
export async function sync(root, { push = false, ticket } = {}) {
  if (!push) return { ok: true, pushed: false }

  const st = await changes(root)
  if (st.branch === 'HEAD') {
    throw failAs(
      'conflict',
      'HEAD 不在任何分支上（detached），这次推送没有可推的分支',
      '先 git switch 回一个分支，再提交 / 推送',
    )
  }
  verifyTicket(ticket, { fingerprint: fingerprintOf(st.files) })

  const res = await gitRun(root, ['push'])
  if (!res.ok) throw failOf('push', res)

  // 普通 git push 把进度写在 stderr；已经对齐时只有一句 Everything up-to-date。
  const pushed = !/everything up-to-date|up to date/i.test(`${res.stderr}\n${res.stdout}`)
  return { ok: true, pushed }
}