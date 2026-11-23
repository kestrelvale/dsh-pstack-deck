// 把右栏面板渲染成一张静态 HTML，用来肉眼看样式（不改产品代码，只是照 client.js 跑一遍）。
// 用法：node scripts/preview.mjs [/tmp/psp-preview.html]
// 假 React 与 test/client.test.mjs 同款：useEffect 立即执行，于是列表能真的渲染出来。
import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addProgress,
  blockersOf,
  childrenOf,
  conflictsOf,
  frontierOf,
  graph,
  loadBoard,
  mapOf,
  mapSections,
  nextOf,
  recommend,
  saveCard,
} from '../src/board.js'
import { suggest } from '../src/suggest.js'
import { buildCatalog, RANK } from '../src/catalog.js'
import { zhOf, GROUP_ZH } from '../src/i18n.js'

const code = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

const React = {
  createElement(type, props, ...kids) {
    return { type, props: props || {}, children: kids.flat(Infinity).filter((k) => k != null && k !== false && k !== true) }
  },
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => { fn() },
  useRef: (init) => ({ current: init }),
  Fragment: 'Fragment',
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const UNITLESS = new Set(['zIndex', 'opacity', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'order', 'zoom'])
const styleAttr = (style) => Object.entries(style || {})
  .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`)
  .join(';')

function toHTML(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (Array.isArray(node)) return node.map(toHTML).join('')
  if (typeof node.type === 'function') return toHTML(node.type(node.props))
  const tag = node.type === 'Fragment' ? null : node.type
  const kids = toHTML(node.children)
  if (!tag) return kids
  const attrs = []
  // SVG 的形状全靠属性吃饭：x/y/width/d/... 得原样透出去，不然截图里是一堆空壳
  for (const [k, v] of Object.entries(node.props || {})) {
    if (k === 'style' || k === 'children' || k === 'key' || k === 'onClick' || v == null) continue
    attrs.push(`${k}="${esc(String(v))}"`)
  }
  if (node.props.style) attrs.push(`style="${esc(styleAttr(node.props.style))}"`)
  return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${kids}</${tag}>`
}

// 真目录，只截前若干条，够看样式
const cat = await buildCatalog()
const groupOf = {}
for (const [g, names] of Object.entries(cat.groups)) for (const n of names) groupOf[n] = g
const groups = cat.groups
const payload = {
  ok: true,
  value: {
    version: cat.version,
    driftOk: true,
    drift: [],
    groups,
    skills: cat.skills.map((s) => ({ ...s, group: groupOf[s.name], zh: zhOf(s), rank: RANK })),
    groupZh: GROUP_ZH,
  },
}

// 看板要有个项目目录才画得出来：临时造一个，塞几张真卡
const proj = await mkdtemp(join(tmpdir(), 'pstack-preview-'))
const seed = async () => {
  const map = await saveCard(proj, {
    kind: 'map',
    title: '把导出改成流式',
    body: '## 去向\n大文件导出不再 OOM，边读边写\n\n## 已经定了\n用 node 的 stream；先只做 CSV\n\n## 还没想清\n断点续传要不要一起做\n\n## 不做什么\n这版不碰 Excel\n',
  })
  const idea = await saveCard(proj, { kind: 'idea', title: '把导出改成流式的，别一次读进内存', body: '大文件导出会 OOM，想边读边写。', parent: map.id, scope: ['src/export'] })
  const bug = await saveCard(proj, { kind: 'bug', title: '登录后偶发 401，刷新一次就好', body: '只在 Safari 上复现。' })
  await addProgress(proj, bug.id, '抓到请求头里少了 cookie', 'doing')
  const task = await saveCard(proj, { kind: 'task', title: '给看板加列筛选', after: [bug.id], parent: map.id, scope: ['src/export/stream.ts'] })
  const after = await saveCard(proj, { kind: 'task', title: '筛选做好后再加排序', after: [task.id] })
  const done = await saveCard(proj, { kind: 'task', title: '把技能正文翻成中文' })
  await addProgress(proj, done.id, '58 篇全齐', 'done')
  const dropped = await saveCard(proj, { kind: 'idea', title: '顺手做个移动端', after: [idea.id] })
  await addProgress(proj, dropped.id, '这版不做', 'dropped')
}
await seed()
const boardView = async () => {
  const b = await loadBoard(proj)
  const cards = b.cards.map((c) => ({
    ...c,
    next: recommend(c, b.cards),
    blocked: blockersOf(c, b.cards),
    children: childrenOf(b.cards, c.id).length,
  }))
  const map = mapOf(b.cards)
  return {
    cwd: proj,
    root: proj,
    project: { name: proj.split('/').pop(), initialized: true, missing: [], rel: '', mapId: map?.id ?? null },
    dir: b.dir,
    cards,
    next: nextOf(cards),
    graph: graph(b.cards),
    frontier: frontierOf(b.cards).map((c) => c.id),
    conflicts: conflictsOf(b.cards),
    map: map ? { id: map.id, title: map.title, sections: mapSections(map), children: childrenOf(b.cards, map.id).length } : null,
  }
}

let loaded = null
const win = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, exports: factory((n) => (n === 'react' ? React : (() => { throw new Error('no module ' + n) })())) }
    },
  },
}
new Function('window', code)(win)

const slots = []
const disposers = []
const ctx = {
  // cordis 语义：effect 立刻跑一遍，卸载时调用它返回的 disposer
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  // 真宿主里服务就绪才回调；预览里一切就绪，直接跑
  inject(_names, fn) { fn() },
  get(name) {
    if (name === 'slots') return { register: (def, Comp) => slots.push({ def, Comp }), inject: (_n, fn) => fn() }
    if (name === 'sidebarRightTabs') return { register: () => () => {} }
    if (name === 'connection') {
      return {
        rpc: {
          call: (_channel, _endpoint, req) => {
            if (req && req.method === 'skill') {
              const n = req.payload.name
              // 路由把 ok/value 拆开后返回，客户端 rpc() 只拿 value
              // 照 hosts.js 的样子去掉 frontmatter，并带上中文正文
              return Promise.all([
                readFile(new URL(`../repo/skills/${n}/SKILL.md`, import.meta.url), 'utf8'),
                readFile(new URL(`../zh/${n}.md`, import.meta.url), 'utf8').catch(() => ''),
              ]).then(([body, bodyZh]) => ({
                ok: true,
                value: {
                  ok: true,
                  ...cat.skills.find((x) => x.name === n),
                  body: body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''),
                  bodyZh,
                },
              }))
            }
            if (req && req.method === 'update') {
              // 演示「有新版本」长什么样：假装 npm 上多了一个 0.2.0
              return Promise.resolve({ ok: true, value: { current: '0.1.0', latest: '0.2.0', hasUpdate: true, cached: false, error: '' } })
            }
            if (req && req.method === 'board') {
              // init 模式：演示「项目还没初始化」那张卡长什么样
              if (process.argv[3] === 'init') {
                return Promise.resolve({
                  ok: true,
                  value: {
                    cwd: join(proj, 'src', 'export'),
                    root: proj,
                    project: { name: proj.split('/').pop(), initialized: false, missing: ['board', 'readme', 'agents'], rel: 'src/export', mapId: null },
                    dir: join(proj, '.pstack', 'board'),
                    cards: [],
                    next: null,
                    graph: { nodes: [], edges: [], lines: [], depthMax: 0 },
                    frontier: [],
                    conflicts: { pairs: [], unscoped: [] },
                    map: null,
                  },
                })
              }
              return boardView().then((value) => ({ ok: true, value }))
            }
            if (req && req.method === 'suggest') return suggest({ cwd: proj, roots: [] }).then((value) => ({ ok: true, value }))
            return Promise.resolve(payload)
          },
        },
      }
    }
    return undefined
  },
}
loaded.exports.apply(ctx)

const Panel = slots[0].Comp
// 目录是异步取回来的：先渲染一次触发请求，等它落定后再渲染一次，才看得到列表。
const render = () => toHTML(React.createElement(Panel, { sessionId: 'preview' }))
render()
await new Promise((r) => setTimeout(r, 300))

// 可选第二参数：`board` 切到看板；其他值当成技能名点开详情
const openName = process.argv[3]
if (openName === 'board' || openName === 'flow' || openName === 'drill' || openName === 'init') {
  const tree = React.createElement(Panel, { sessionId: 'preview' })
  const walk = (node, label = '看板') => {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some((n) => walk(n, label))
    if (typeof node.type === 'function') return walk(node.type(node.props), label)
    const kids = node.children || []
    // 文本可能包在子节点里（SVG 的 <text> 就是），所以除了直接相等也认「子树里有这句话」
    const flat = (n) => (Array.isArray(n) ? n.map(flat).join('') : typeof n === 'string' ? n : n && n.children ? flat(n.children) : '')
    if (node.props && typeof node.props.onClick === 'function' && (kids.includes(label) || flat(kids).includes(label))) {
      node.props.onClick()
      return true
    }
    return walk(kids, label)
  }
  walk(tree)
  await new Promise((r) => setTimeout(r, 300))
  if (openName === 'flow' || openName === 'drill') {
    walk(React.createElement(Panel, { sessionId: 'preview' }), '流程')
    await new Promise((r) => setTimeout(r, 200))
  }
  if (openName === 'drill') {
    // 点第一格节点，看下钻出来的命令和「标记完成」
    walk(React.createElement(Panel, { sessionId: 'preview' }), '登录后偶发 …')
    await new Promise((r) => setTimeout(r, 200))
  }
}
if (openName && !['board', 'flow', 'drill', 'init'].includes(openName)) {
  const seen = new Set()
  const click = (node) => {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some(click)
    if (typeof node.type === 'function') return click(node.type(node.props))
    const text = JSON.stringify(node.children || [])
    if (node.props && typeof node.props.onClick === 'function' && text.includes('/' + openName) && !seen.has(node)) {
      seen.add(node)
      node.props.onClick()
      return true
    }
    return click(node.children)
  }
  click(JSON.parse(JSON.stringify({ type: 'div', props: {}, children: [] })))
  // 上面那份是空壳，真正的树要重新渲染才有 onClick
  const tree = React.createElement(Panel, { sessionId: 'preview' })
  click(tree)
  await new Promise((r) => setTimeout(r, 200))
}
const body = render()
// 模拟右栏：深色底 + 400px 宽的面板
const html = `<!doctype html><html><meta charset="utf-8"><title>pstack 面板预览</title>
<style>html,body{margin:0;overflow:hidden;height:100%;background:#0d0f13}</style>
<body><div style="width:400px;min-height:1000px">${body}</div></body></html>`
const out = process.argv[2] || '/tmp/psp-preview.html'
await writeFile(out, html)
console.log(out, html.length, 'bytes')
