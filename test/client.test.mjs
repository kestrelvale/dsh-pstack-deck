// 面板半的离线冒烟：不打开浏览器，用最小的 React 假件把 client.js 跑一遍。
// 抓的是方言错（import 了东西、apply 没注册、组件一渲染就抛）——这些错在真机上
// 只表现为「右栏没有这个 tab」，原因要去浏览器控制台才看得到。
//
// 假 React 的 useEffect 是立即执行的：这样面板「挂载 → 请求目录 → 渲染列表」这条
// 真路径能在 node 里跑完，而不是只渲染出「读目录…」就收工。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const code = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

const React = {
  createElement(type, props, ...kids) {
    return { type, props: props || {}, children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== true) }
  },
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => { fn() },
  useRef: (init) => ({ current: init }),
  Fragment: 'Fragment',
}

const textOf = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  // 真 React 会去调函数组件；这里跟着调，否则 List/Guide 的子树看不见
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  if (node.children) return textOf(node.children)
  return ''
}

// 找一个按钮文字是 label 的元素并点它（面板里所有交互都挂在 onClick 上）
function clickByText(node, label) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((n) => clickByText(n, label))
  if (typeof node.type === 'function') return clickByText(node.type(node.props), label)
  const kids = node.children || []
  if (node.props && typeof node.props.onClick === 'function' && (kids.includes(label) || textOf(node).includes(label))) {
    node.props.onClick()
    return true
  }
  return clickByText(kids, label)
}

function boot(rpcImpl, { ready = true } = {}) {
  let loaded = null
  const win = {
    __ModuleLoader__: {
      load({ id, factory }) {
        loaded = { id, exports: factory((n) => (n === 'react' ? React : (() => { throw new Error('没有这个模块：' + n) })())) }
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', code)(win)
  assert.equal(loaded.id, 'dsh-pstack-deck', 'loader id 必须和 package 的 client 对得上')

  const got = { tabs: [], slots: [], injected: [], effects: [] }
  // 真宿主里 sidebarRightTabs 在 apply 跑完之后才就绪——所以这里也先不给，
  // 由 readyTabs() 模拟「服务出现」。之前一次性 ctx.get() 拿到 undefined 就
  // 永久放弃注册，面板装好了却没有任何入口。
  let tabsReady = false
  const pending = []
  const ctx = {
    get(name) {
      if (name === 'slots') {
        return {
          register(def, Comp) { got.slots.push({ name: def.name, key: def.key, id: def.id, Comp, inject: def.inject }); return () => {} },
          inject(name, fn) { got.injected.push(name); return fn() },
        }
      }
      if (name === 'sidebarRightTabs') {
        return tabsReady ? { register(def) { got.tabs.push(def); return () => {} } } : undefined
      }
      if (name === 'connection') {
        return { rpc: { call: (_ch, _ep, call) => Promise.resolve(rpcImpl(call.method, call.payload)) } }
      }
      return undefined
    },
    inject(names, cb) { pending.push({ names, cb }) },
    effect(fn) { got.effects.push(fn()) },
  }
  loaded.exports.apply(ctx)
  got.readyTabs = () => {
    tabsReady = true
    pending.splice(0).forEach((p) => p.cb())
  }
  got.pendingInject = pending
  if (ready) got.readyTabs()
  return { loaded, got }
}

const catalogOk = {
  ok: true,
  value: {
    version: '0.15.46',
    groups: { workflow: ['tdd'], core: ['principle-laziness-protocol'] },
    skills: [
      { name: 'tdd', zh: '先写一个会失败的测试', description: 'x', deps: [], argumentHint: '', modelInvocable: false, principle: null },
      { name: 'principle-laziness-protocol', zh: '能删就删，改得越少越好', deps: [], principle: { group: 'core', rule: 'Bias toward deletion.' } },
    ],
    missingDeps: {},
    drift: { missing: [], changed: [] },
    driftOk: true,
  },
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

test('面板半：方言正确——零 import，只 require react', () => {
  assert.doesNotMatch(code, /^\s*import\s/m, '客户端产物里不能有 import（没有打包器）')
  const reqs = [...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(reqs)], ['react'])
})

test('面板半：apply 之后右栏有 tab + 标题 + tab 本体 + 输入框 dock', () => {
  const { got } = boot(() => catalogOk, { ready: false })
  // 服务还没就绪时不能抢跑：拿到 undefined 就注册，是「面板装了但没有入口」的成因
  assert.equal(got.tabs.length, 0)
  assert.deepEqual(got.pendingInject.map((p) => p.names), [['sidebarRightTabs']])
  got.readyTabs()
  assert.equal(got.tabs.length, 1)
  assert.equal(got.tabs[0].id, 'psp-skills')
  assert.equal(got.tabs[0].priority, 'builtin')
  assert.equal(got.tabs[0].title(), 'pstack')
  assert.deepEqual(got.tabs[0].guide.map((g) => g.order), [70])

  assert.deepEqual(got.slots.map((s) => s.name).sort(), ['conversation.input.dock', 'sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  const pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab')
  assert.equal(pane.key, 'psp-skills')
  assert.deepEqual(pane.inject('sess-1'), { sessionId: 'sess-1' })
})

test('面板半：挂载 → 取目录 → 渲染引导与分组', async () => {
  const { got } = boot(() => catalogOk)
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  assert.match(textOf(Pane({ sessionId: 's1' })), /读看板/, '默认落在看板，第一帧是加载态')
  await tick()
  assert.equal(clickByText(Pane({ sessionId: 's1' }), '全部技能'), true, '技能清单是二级入口')
  const text = textOf(Pane({ sessionId: 's1' }))
  assert.match(text, /v0\.15\.46/)
  assert.match(text, /先写一个会失败的测试/)
  assert.match(text, /能删就删/)
  assert.match(text, /不知道点哪个/)
  assert.match(text, /工作流 · 1/)
  assert.match(text, /核心准则 · 1/)
})

test('面板半：读不到目录时给人能照着做的一句话', async () => {
  const { got } = boot(() => ({ ok: false, error: { message: '宿主没响应' } }))
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's2' })
  await tick()
  clickByText(Pane({ sessionId: 's2' }), '全部技能')
  const text = textOf(Pane({ sessionId: 's2' }))
  assert.match(text, /读不到 pstack 目录/)
  assert.match(text, /宿主没响应/)
})

test('面板半：副本和仓库不一致时会催同步', async () => {
  const drift = { ...catalogOk.value, driftOk: false, drift: { missing: ['tdd'], changed: ['architect'] } }
  const { got } = boot(() => ({ ok: true, value: drift }))
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's3' })
  await tick()
  clickByText(Pane({ sessionId: 's3' }), '全部技能')
  const text = textOf(Pane({ sessionId: 's3' }))
  assert.match(text, /和仓库不一致/)
  assert.match(text, /npm run sync/)
})

test('面板半：进来就站在看板上，不用先点技能页', async () => {
  const board = {
    ok: true,
    value: {
      cwd: '/proj', root: '/proj', dir: '/proj/.pstack/board',
      project: { name: 'proj', initialized: true, missing: [], rel: '' },
      cards: [{ id: 1, kind: 'task', state: 'todo', title: '给看板加列筛选', body: '', progress: 0, next: { skill: 'architect', why: '先画结构' } }],
    },
  }
  const sug = {
    ok: true,
    value: {
      layer: 'project',
      items: [{ id: '#1', cardId: 1, project: '', title: '给看板加列筛选', skill: 'tdd', why: '先写测试', urgency: 0.9, certainty: 0.9, factors: {}, prompt: '/tdd #1 给看板加列筛选' }],
    },
  }
  const seen = []
  const { got } = boot((method) => {
    seen.push(method)
    if (method === 'suggest') return sug
    return method === 'board' ? board : catalogOk
  })
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's0' })
  await tick()
  // 一帧都不点，就该已经在看板上
  assert.equal(seen.includes('board'), true, '默认视图要自己去看板取数')
  const text = textOf(Pane({ sessionId: 's0' }))
  assert.match(text, /📁 proj/, '要看出这是哪个项目')
  assert.match(text, /建议接下来做这几件/, '看板页先给建议')
  assert.match(text, /给看板加列筛选/)
  assert.doesNotMatch(text, /不知道点哪个/, '引导语属于技能页，不该出现在看板上')
  // 看板页自带技能清单：只列建议里点得到的，带中文一句话和「用这个」
  assert.match(text, /这几件事要用的技能/)
  assert.match(text, /\/tdd/)
  assert.match(text, /先写一个会失败的测试/)
  assert.equal(clickByText(Pane({ sessionId: 's0' }), '用这个'), true, '清单里的技能要能一键用')
  assert.match(textOf(Pane({ sessionId: 's0' })), /\/tdd/, '点完草稿里是斜杠命令')
})

test('面板半：看板视图列出卡和下一步，按钮点得动', async () => {
  const board = {
    ok: true,
    value: {
      cwd: '/proj',
      dir: '/proj/.pstack/board',
      next: { card: { id: 2, title: '登录偶发 401' }, skill: 'correct', why: '把它变成一条规则' },
      cards: [
        { id: 1, kind: 'idea', state: 'idea', title: '把导出改成流式', body: '', progress: 0, next: { skill: 'figure-it-out', why: '先设计路线' } },
        { id: 2, kind: 'bug', state: 'doing', title: '登录偶发 401', body: 'Safari 复现', progress: 1, next: { skill: 'correct', why: '变成规则' } },
      ],
    },
  }
  const sug = {
    ok: true,
    value: {
      layer: 'project',
      items: [
        { id: '#2', cardId: 2, project: '', title: '登录偶发 401', skill: 'correct', why: '把它变成一条规则', urgency: 0.9, certainty: 0.9, factors: { state: 1, kind: 1, progress: 0.33, fresh: 1 }, prompt: '/correct #2 登录偶发 401' },
        { id: '#1', cardId: 1, project: '', title: '把导出改成流式', skill: 'figure-it-out', why: '先设计路线', urgency: 0.29, certainty: 0.9, factors: { state: 0.3, kind: 0, progress: 0, fresh: 1 }, prompt: '/figure-it-out #1 把导出改成流式' },
      ],
    },
  }
  const seen = []
  const { got } = boot((method) => {
    seen.push(method)
    if (method === 'suggest') return sug
    return method === 'board' ? board : catalogOk
  })
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's9' })
  await tick()
  assert.equal(clickByText(Pane({ sessionId: 's9' }), '看板'), true, '得有个看板入口')
  await tick()
  const text = textOf(Pane({ sessionId: 's9' }))
  assert.equal(seen.includes('board'), true, '切到看板要去宿主取一次')
  assert.match(text, /建议接下来做这几件 · 按这个项目推/)
  assert.match(text, /登录偶发 401/)
  assert.match(text, /correct/)
  // 建议默认收起（只看标题和分数），点开才露出能直接粘的命令
  assert.equal(clickByText(Pane({ sessionId: 's9' }), '把导出改成流式'), true, '建议标题要能点开')
  const detail = textOf(Pane({ sessionId: 's9' }))
  assert.match(detail, /\/figure-it-out #1 把导出改成流式/, '展开后要有带卡号的提示词')
  assert.match(detail, /Jev 分解/)
  assert.match(detail, /执行这条命令/)
  assert.match(text, /把导出改成流式/)
  assert.match(text, /正在做|在做/)
})

test('看板：项目还没初始化时给一张初始化卡，点了就去建', async () => {
  const board = {
    ok: true,
    value: {
      cwd: '/proj/src/api',
      root: '/proj',
      project: { name: 'proj', initialized: false, missing: ['board', 'readme', 'agents'], rel: 'src/api', mapId: null },
      dir: '/proj/.pstack/board',
      next: null,
      cards: [],
      frontier: [],
      conflicts: { pairs: [], unscoped: [] },
      map: null,
    },
  }
  const inited = {
    ok: true,
    value: { ...board.value, project: { ...board.value.project, initialized: true, missing: [] }, cards: [{ id: 1, kind: 'map', state: 'idea', title: 'proj 的路线图', body: '', progress: 0, next: null }], created: ['.pstack/board/1-proj-的路线图.md', '.pstack/README.md', 'AGENTS.md'] },
  }
  const seen = []
  const { got } = boot((method) => {
    seen.push(method)
    if (method === 'suggest') return { ok: true, value: { layer: 'seed', items: [] } }
    if (method === 'init') return inited
    return method === 'board' ? board : catalogOk
  })
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's10' })
  await tick()
  clickByText(Pane({ sessionId: 's10' }), '看板')
  await tick()
  const text = textOf(Pane({ sessionId: 's10' }))
  assert.match(text, /这个项目还没初始化：proj/)
  assert.match(text, /地图卡/)
  assert.match(text, /当前是它的子目录：src\/api/, '子目录里的会话要说明板在项目根')
  assert.equal(clickByText(Pane({ sessionId: 's10' }), '初始化这个项目'), true)
  await tick()
  assert.equal(seen.includes('init'), true, '点初始化要真的走宿主')
  assert.doesNotMatch(textOf(Pane({ sessionId: 's10' })), /这个项目还没初始化/)
})

test('看板：流程图视图画出节点与箭头，废弃的单独标出', async () => {
  const board = {
    ok: true,
    value: {
      cwd: '/proj',
      dir: '/proj/.pstack/board',
      next: null,
      cards: [
        { id: 1, kind: 'task', state: 'doing', owner: 'me', title: '先把 session 换掉', body: '', progress: 0, after: [], next: { skill: 'tdd', why: '先写个会失败的测试' } },
        { id: 2, kind: 'task', state: 'todo', title: '再加刷新', body: '', progress: 0, after: [1], blocked: [1], next: null },
        { id: 3, kind: 'idea', state: 'dropped', title: '顺手做移动端', body: '', progress: 0, after: [1], next: null },
      ],
      graph: {
        nodes: [
          { id: 1, title: '先把 session 换掉', kind: 'task', state: 'doing', depth: 0 },
          { id: 2, title: '再加刷新', kind: 'task', state: 'todo', depth: 1 },
          { id: 3, title: '顺手做移动端', kind: 'idea', state: 'dropped', depth: 1 },
        ],
        edges: [{ from: 1, to: 2 }, { from: 1, to: 3 }],
        lines: [[1, 2]],
        depthMax: 1,
      },
    },
  }
  const { got } = boot((method) => (method === 'board' ? board : method === 'suggest' ? { ok: false } : catalogOk))
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's10' })
  await tick()
  clickByText(Pane({ sessionId: 's10' }), '看板')
  await tick()
  assert.equal(clickByText(Pane({ sessionId: 's10' }), '流程'), true, '得能切到流程图')
  await tick()
  const text = textOf(Pane({ sessionId: 's10' }))
  assert.match(text, /先把 session 换掉/)
  assert.match(text, /再加刷新/)
  assert.match(text, /顺手做移动端/)
  assert.match(text, /废弃/)
  assert.match(text, /列表/, '切过去之后按钮该变成返回列表')

  // 预期线路：没做完的卡后面跟着虚线小格「推荐的技能」和「完成」
  assert.match(text, /→ \/tdd/, '流程图要画出下一步推荐什么')
  assert.match(text, /✓ 完成 #1/, '预期线路要落到「完成」')

  // 点节点 → 下钻：给命令、给完结入口
  assert.equal(clickByText(Pane({ sessionId: 's10' }), '先把 session 换掉'), true, '节点要能点开')
  const drill = textOf(Pane({ sessionId: 's10' }))
  assert.match(drill, /标记完成/, '下钻里要有完结入口')
  assert.match(drill, /交回/, '在做中的卡给的是交回，不是抢回来')
  assert.match(drill, /\/tdd #1 先把 session 换掉/, '下钻要给出带卡号的命令')
})

test('看板：地图、冲突横幅、可开工与认领按钮都在', async () => {
  const board = {
    ok: true,
    value: {
      cwd: '/proj',
      dir: '/proj/.pstack/board',
      next: null,
      frontier: [1, 3],
      map: {
        id: 9,
        title: '把导出改成流式',
        children: 2,
        sections: { destination: '大文件导出不 OOM', decisions: '用 node 的 stream', fog: '断点续传要不要做', out: '' },
      },
      conflicts: { pairs: [{ a: 1, b: 2, paths: ['src/api'] }], unscoped: [] },
      graph: { nodes: [], edges: [], lines: [], depthMax: 0 },
      cards: [
        { id: 9, kind: 'map', state: 'todo', title: '把导出改成流式', body: '', progress: 0, after: [] },
        { id: 1, kind: 'task', state: 'doing', title: '改接口返回', body: '', progress: 0, after: [], owner: 'sess-a', blocked: [] },
        { id: 2, kind: 'task', state: 'doing', title: '补接口测试', body: '', progress: 0, after: [], owner: 'sess-b', blocked: [] },
        { id: 3, kind: 'task', state: 'todo', title: '换掉读取方式', body: '', progress: 0, after: [], blocked: [] },
        { id: 4, kind: 'task', state: 'todo', title: '再改调用方', body: '', progress: 0, after: [1], blocked: [1] },
      ],
    },
  }
  const { got } = boot((method) => (method === 'board' ? board : method === 'suggest' ? { ok: false } : catalogOk))
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's11' })
  await tick()
  clickByText(Pane({ sessionId: 's11' }), '看板')
  await tick()
  const text = textOf(Pane({ sessionId: 's11' }))
  assert.match(text, /把导出改成流式/)
  assert.match(text, /大文件导出不 OOM/)
  assert.match(text, /断点续传要不要做/)
  assert.match(text, /并行冲突/)
  assert.match(text, /可开工/)
  assert.match(text, /被挡着/)
  assert.match(text, /我来做/)
  assert.match(text, /交回/)
})

// 闭环的面板侧：点「完成」必须先写一句结论，写完卡片和推荐一起刷新。
// 这两条对着用户报的两个现象：「状态不往回写」「推荐不重新推荐」。
test('看板：完成要先写结论；写完卡片落进完成组，建议跟着重算', async () => {
  const calls = []
  const mkBoard = (state, answer) => ({
    ok: true,
    value: {
      cwd: '/proj',
      dir: '/proj/.pstack/board',
      next: null,
      frontier: state === 'doing' ? [] : [1],
      cards: [{
        id: 1, kind: 'bug', state, owner: state === 'doing' ? 'me' : undefined,
        title: '登录后偶发 401', body: '', progress: 1, after: [],
        answer,
        next: state === 'doing' ? { skill: 'correct', why: '把这次修复变成一条规则' } : null,
        blocked: [],
      }],
      graph: { nodes: [{ id: 1, title: '登录后偶发 401', kind: 'bug', state, depth: 0 }], edges: [], lines: [], depthMax: 0 },
      conflicts: { pairs: [], unscoped: [] },
      map: null,
    },
  })
  let finished = false
  const rpc = (method, payload) => {
    calls.push([method, payload])
    if (method === 'boardAct') {
      finished = payload.action === 'done'
      return mkBoard('done', payload.note)
    }
    if (method === 'board') return finished ? mkBoard('done', '加了 cookie 重试') : mkBoard('doing')
    if (method === 'suggest') return { ok: true, value: { layer: 'project', items: finished ? [] : [{ cardId: 1, skill: 'correct', title: '登录后偶发 401', why: 'x', urgency: 0.9, certainty: 0.9, prompt: '/correct #1 登录后偶发 401' }], scanned: 1 } }
    return catalogOk
  }
  const { got } = boot(rpc)
  const Pane = got.slots.find((s) => s.name === 'sidebar.right.pane.tab').Comp
  Pane({ sessionId: 's20' })
  await tick()

  assert.equal(clickByText(Pane({ sessionId: 's20' }), '完成'), true, '在做的卡要能点完成')
  assert.match(textOf(Pane({ sessionId: 's20' })), /做成了什么、验过什么/, '要给写结论的地方')

  // 空结论点确认：不许落盘，只提示
  const before = calls.filter(([m]) => m === 'boardAct').length
  clickByText(Pane({ sessionId: 's20' }), '确认完成')
  assert.equal(calls.filter(([m]) => m === 'boardAct').length, before, '没写结论不能提交')
  assert.match(textOf(Pane({ sessionId: 's20' })), /写一句做成了什么/)

  // 写一句结论再确认
  const findTextarea = (node) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findTextarea(n)
        if (hit) return hit
      }
      return null
    }
    if (typeof node.type === 'function') return findTextarea(node.type(node.props))
    if (node.type === 'textarea') return node
    return node.children ? findTextarea(node.children) : null
  }
  const ta = findTextarea(Pane({ sessionId: 's20' }))
  assert.ok(ta, '要有输入框')
  ta.props.onChange({ target: { value: '加了 cookie 重试，Safari 复测通过' } })
  clickByText(Pane({ sessionId: 's20' }), '确认完成')
  await tick()

  const acts = calls.filter(([m]) => m === 'boardAct')
  assert.equal(acts.length, 1)
  assert.deepEqual(acts[0][1].action, 'done')
  assert.match(acts[0][1].note, /Safari 复测通过/)
  assert.ok(calls.filter(([m]) => m === 'suggest').length >= 2, '动作之后要重新算建议')

  const text = textOf(Pane({ sessionId: 's20' }))
  assert.match(text, /完成 · 1/, '卡片要真的落进完成组')
  assert.match(text, /重开/, '结束的卡要给重开入口——废弃不是删掉')
})
