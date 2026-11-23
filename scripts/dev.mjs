#!/usr/bin/env node
// 开发热循环：改完 src/ 自动重启一个临时宿主，浏览器刷新就见到新代码。
//
// 为什么是「重启」而不是 HMR：宿主半注册的是 cordis 服务与工具，客户端 bundle
// 在启动时按内容哈希构建一次，两者都没有热替换入口。脚本能做的只是把手动
// 退出重开压成一次保存。
//
// 用法：
//   node scripts/dev.mjs                    # 默认 web profile，端口 5599
//   node scripts/dev.mjs web 5599
//   node scripts/dev.mjs desktop 5600       # 注意：桌面 app 不能这样起，仅 web/tui 适用

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const profile = process.argv[2] || 'web'
const port = process.argv[3] || '5599'
const WATCH = ['src', 'cordis.patch.yml', 'package.json']

let child = null
let timer = null
let started = 0

function boot() {
  if (child) {
    child.kill('SIGTERM')
    child = null
  }
  started = Date.now()
  child = spawn('dsh', ['--profile', profile, '--port', port], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    // 自己杀的（重启）不算崩，也不重开
    if (Date.now() - started < 1500 && signal) return
    if (code) console.log(`\n[dev] 宿主退出了（code ${code}），改一次代码会重开；Ctrl+C 结束`)
    child = null
  })
  console.log(`\n[dev] 宿主起来了：http://127.0.0.1:${port}（改 src/ 自动重启）`)
}

function schedule(why) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    console.log(`\n[dev] ${why} → 重启`)
    boot()
  }, 250)
}

boot()
for (const target of WATCH) {
  watch(join(ROOT, target), { recursive: target === 'src' }, (_e, file) => {
    if (!file || /\.(md|png)$/.test(file)) return // 文档改动不影响宿主
    schedule(file)
  })
}

const bye = () => {
  clearTimeout(timer)
  if (child) child.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
