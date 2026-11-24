// dsh-pstack-deck · 面板半（浏览器）
//
// 手写 __ModuleLoader__ 方言，零构建、零 import：只 require('react')。
// 数据全部从宿主那一条 /api/psp 拿，面板自己不存清单——所以 58 个技能改了名字，
// 这里不用跟着改。
//
// 三个界面状态：列表（搜/分组）、详情（正文）、引导（五步上手）。

window.__ModuleLoader__.load({
  id: 'dsh-pstack-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const TAB_ID = 'psp-skills'
    const CARRIER_CHANNEL = '/api'
    const CARRIER_ENDPOINT = 'psp'

    let __CTX = null

    // ------------------------------------------------------------ 数据

    const rpc = async (method, payload) => {
      const conn = __CTX && __CTX.get ? __CTX.get('connection') : undefined
      if (!conn || !conn.rpc) throw new Error('connection 服务不在')
      const res = await conn.rpc.call(CARRIER_CHANNEL, CARRIER_ENDPOINT, { method, payload })
      if (res && res.ok) return res.value
      const why = (res && res.error) || {}
      const e = new Error(why.message || why.code || '宿主没有响应')
      e.kind = why.kind
      e.hint = why.hint || ''
      e.code = why.code
      throw e
    }

    // 每个会话一份 store。右栏并排开两个会话时，两边各读各的板、各记各的草稿，
    // 不会互相覆盖；没有会话号时退回 shared。
    // 竞品 dsh-mattpocock-skills-deck 的 lib/client.js:22768 就是这个形状：
    //   const storeOf = (sid) => stores[sid] || (stores[sid] = makeStore(sid))
    //   const useStore = (sid) => 订阅那一个 store 的 tick
    // 差别只有一处：它不清 store（会话关掉也不回收），我这里也不清——一张板才几 KB，
    // 真到了几百个会话再谈回收（ponytail: 无上界 Map，靠会话切换频率天然很低）。
    const makeStore = () => {
      const st = {
        catalog: null,
        error: '',
        loading: true,
        q: '',
        group: 'all',
        open: null, // 技能名：详情页
        detail: null,
        draft: '', // 详情页里「注入」后的原文，注入失败时给用户手抄
        zhOnly: false, // 有中文正文时默认显示中文，点一下切回原文
        zoom: 1, // 拓扑画布缩放
        plays: null, // 22 套剧本：技能之间的先后顺序在剧本里，不在技能自己身上
        openPlay: '', // 展开的是哪一套
        env: null, // 环境自检结果：没跑过就是 null，面板显示「自检…」
        envLoading: false,
        finish: null, // { id, state }：正在收尾哪张卡，收尾必须写一句结论
        finNote: '',
        sugOpen: '', // 展开了哪条建议（看 Jev 分数和命令）
        node: null, // 流程图里下钻的卡号
        work: null, // 在办表：谁在做哪张卡（跨会话）
        git: null, // 版本页：改动 + 票
        gitErr: null, // {kind,message,hint}
        gitLoading: false,
        commitMsg: '',
        commitBusy: false,
        filter: 'all', // 看板过滤器：all | open | doing | done —— 默认全看，收窄是用户主动
        view: 'board', // board | play | skills | env | git —— 默认看板：进来先看到「这个项目要干什么」，而不是 58 个技能名
        sid: '', // 会话号：看板要用它换出这个会话的项目目录
        cwd: '', // 这个会话的工作目录：面板自己先给，宿主就不必再猜
        board: null,
        sug: null, // 三层决策给出的 3~5 条建议
        idea: '', // 新卡标题
        kind: 'idea',
        showDropped: false,
        flow: false, // 看板：列表 or 流程图
        toast: '',
        toastAt: 0,
        upd: null, // {current, latest, hasUpdate, error}；null = 还没问过 npm
        updBusy: false,
        subs: new Set(),
      }
      st.set = (patch) => {
        Object.assign(st, patch)
        st.subs.forEach((fn) => fn(st))
      }
      st.emit = () => st.subs.forEach((fn) => fn(st))
      return st
    }
    const sharedStore = makeStore()
    const stores = new Map()
    const storeOf = (sid) => {
      const key = String(sid || '')
      if (!key) return sharedStore
      let st = stores.get(key)
      if (!st) {
        st = makeStore()
        st.sid = key
        stores.set(key, st)
      }
      return st
    }
    // 订阅某一个会话的 store：会话号变了就换订阅，旧面板不会收到新会话的通知
    const useStore = (sid) => {
      const st = storeOf(sid)
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const fn = () => force((n) => n + 1)
        st.subs.add(fn)
        return () => st.subs.delete(fn)
      }, [st])
      return st
    }
    // 组件里统一从 props 拿自己那份 store
    const bind = (props) => {
      const st = (props && props.st) || sharedStore
      return [st, st.set]
    }

    const load = async (st, fresh) => {
      const set = st.set
      set({ loading: !st.catalog, error: '' })
      try {
        const cat = await rpc('catalog', fresh ? { fresh: true } : {})
        st.set({ catalog: cat, loading: false })
      } catch (e) {
        st.set({ loading: false, error: String((e && e.message) || e) })
      }
    }

    // 问一次 npm 上有没有新版本。宿主那半缓存十分钟，所以开面板顺手查一下不心疼。
    // 更新这件事其实是全局的（问的是 npm 上有没有新版），但挂在 store 上，
    // 免得再单独拉一套状态；哪个会话先问谁先拿结果。
    const checkUpd = async (st, fresh) => {
      if (st.updBusy) return
      st.set({ updBusy: true })
      try {
        const r = await rpc('update', fresh ? { fresh: true } : {})
        st.set({ upd: r, updBusy: false })
      } catch (e) {
        st.set({ upd: { error: String((e && e.message) || e) }, updBusy: false })
      }
    }

    const openSkill = async (st, name) => {
      st.set({ open: name, detail: null, draft: '' })
      try {
        const d = await rpc('skill', { name })
        if (st.open === name) st.set({ detail: d })
      } catch (e) {
        if (st.open === name) st.set({ detail: { ok: false, message: String((e && e.message) || e) } })
      }
    }

    // 注入输入框：宿主把 setDraft 挂在输入区 dock 组件的 props 上，
    // 所以得靠一个零高度 dock 组件把它接住。
    let inputDraft = null
    const Dock = (props) => {
      React.useEffect(() => {
        if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
          inputDraft = props.inputActions.setDraft
        }
      }, [props && props.inputActions])
      return null
    }

    const inject = (st, line) => {
      const set = st.set
      const text = line.endsWith('\n') ? line : line + '\n'
      set({ draft: text })
      if (typeof inputDraft === 'function') {
        try {
          inputDraft(text)
          set({ toast: '已放进输入框，按回车发出', toastAt: Date.now() })
          return
        } catch (e) {
          /* 掉到剪贴板 */
        }
      }
      try {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text)
          set({ toast: '输入框没接上，已复制到剪贴板', toastAt: Date.now() })
          return
        }
      } catch (e) {
        /* 掉到手抄 */
      }
      set({ toast: '输入框没接上，下面这行手动复制', toastAt: Date.now() })
    }

    // ------------------------------------------------------------ 样式

    const C = {
      bg: 'var(--dsw-alias-bg-layer-1, #16181d)',
      card: 'var(--dsw-alias-bg-layer-2, #1c1f26)',
      line: 'var(--dsw-alias-border-l1, #2a2d35)',
      fg: 'var(--dsw-alias-label-primary, #e6edf3)',
      dim: 'var(--dsw-alias-label-secondary, #a1a1aa)',
      faint: 'var(--dsw-alias-label-tertiary, #6b7280)',
      accent: 'var(--dsw-alias-label-accent, #7aa2f7)',
      mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    }

    const s = {
      wrap: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: 0, fontFamily: 'var(--dsw-font-family)', fontSize: 13, color: C.fg, background: C.bg },
      head: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', borderBottom: '1px solid ' + C.line, flex: 'none' },
      body: { flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px 10px 16px' },
      input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: '1px solid ' + C.line, background: C.card, color: C.fg, fontSize: 12, outline: 'none' },
      chip: (on) => ({ padding: '3px 8px', borderRadius: 999, border: '1px solid ' + (on ? C.accent : C.line), background: on ? 'rgba(122,162,247,.14)' : 'transparent', color: on ? C.accent : C.dim, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }),
      card: (on) => ({ border: '1px solid ' + (on ? C.accent : C.line), borderRadius: 8, background: C.card, padding: '8px 10px', marginBottom: 6, cursor: 'pointer', boxSizing: 'border-box', minWidth: 0 }),
      btn: (kind) => ({
        padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
        border: '1px solid ' + (kind === 'primary' ? 'transparent' : C.line),
        background: kind === 'primary' ? C.accent : 'transparent',
        color: kind === 'primary' ? '#0d1117' : C.fg,
        fontWeight: kind === 'primary' ? 600 : 400,
      }),
      badge: (tone) => ({ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid ' + C.line, color: tone === 'warn' ? '#f0b132' : C.faint, whiteSpace: 'nowrap' }),
      name: { fontFamily: C.mono, fontSize: 12, fontWeight: 600 },
      dim: { color: C.dim },
      faint: { color: C.faint, fontSize: 11 },
    }

    // ------------------------------------------------------------ Markdown 渲染（够用就停）

    // 只处理技能正文里真正出现的四种行：标题、列表、代码块、段落。
    // 不做表格/链接/引用——pstack 正文里没有，加解析器是给未来写代码。
    const inline = (text, key) => {
      const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
      return h('span', { key }, parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          return h('code', { key: i, style: { fontFamily: C.mono, fontSize: 12, background: 'rgba(255,255,255,.06)', padding: '1px 4px', borderRadius: 4 } }, p.slice(1, -1))
        }
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return h('strong', { key: i }, p.slice(2, -2))
        return p
      }))
    }

    const renderMd = (text) => {
      const lines = String(text || '').split(/\r?\n/)
      const out = []
      let fence = null
      let buf = []
      const flushCode = (i) => {
        if (buf.length) out.push(h('pre', { key: 'c' + i, style: { margin: '6px 0', padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,.28)', overflowX: 'auto', fontFamily: C.mono, fontSize: 11.5, lineHeight: 1.55 } }, buf.join('\n')))
        buf = []
      }
      lines.forEach((line, i) => {
        if (line.trim().startsWith('```')) {
          if (fence) { flushCode(i); fence = null } else { fence = true }
          return
        }
        if (fence) { buf.push(line); return }
        const t = line.trim()
        if (!t) return
        const head = t.match(/^(#{1,4})\s+(.*)$/)
        if (head) {
          const lvl = head[1].length
          out.push(h('div', { key: i, style: { margin: '10px 0 4px', fontWeight: 650, fontSize: lvl <= 2 ? 14 : 12.5, color: lvl === 1 ? C.fg : C.fg } }, inline(head[2], 'h' + i)))
          return
        }
        const li = t.match(/^([-*+]|\d+\.)\s+(.*)$/)
        if (li) {
          out.push(h('div', { key: i, style: { display: 'flex', gap: 6, margin: '2px 0 2px 2px', lineHeight: 1.6 } }, [
            h('span', { key: 'b', style: { color: C.faint, flex: 'none' } }, li[1] === '-' || li[1] === '*' || li[1] === '+' ? '·' : li[1]),
            h('span', { key: 't', style: { minWidth: 0, wordBreak: 'break-word' } }, inline(li[2], 'l' + i)),
          ]))
          return
        }
        out.push(h('div', { key: i, style: { margin: '4px 0', lineHeight: 1.65, wordBreak: 'break-word' } }, inline(t, 'p' + i)))
      })
      flushCode('end')
      return out
    }

    // ------------------------------------------------------------ 视图

    const GUIDE = [
      { id: 'start', title: '先开风格', when: '第一次用，想让 agent 按这套准则干活', inject: '/poteto-mode' },
      { id: 'read', title: '先看再改', when: '要动一块不熟的代码', inject: '/how 这块代码怎么跑起来的？改动应该落在哪一层？' },
      { id: 'fix', title: '修对地方', when: '有 bug，但不确定根因', inject: '/principle-fix-root-causes 这个 bug 的第一现场在哪？' },
      { id: 'prove', title: '证明能用', when: '改完了，准备说「做完了」', inject: '/principle-prove-it-works 帮我真跑一遍，拿真实结果说话' },
      { id: 'own', title: '变成你的', when: '用顺手了，想让它记住你的习惯', inject: '/automate-me' },
    ]

    const GROUP_ORDER = ['workflow', 'core', 'architecture', 'verification', 'delegation', 'meta']
    const GROUP_ZH = { workflow: '工作流', core: '核心准则', architecture: '架构', verification: '验证', delegation: '分工', meta: '元准则' }

    const Badge = (props) => h('span', { style: s.badge(props.tone) }, props.children)

    const SkillRow = (props) => {
      const { skill, cat } = props
      const [st] = bind(props)
      const missing = cat.missingDeps && cat.missingDeps[skill.name]
      const deps = skill.deps || []
      return h('div', {
        style: s.card(false),
        onClick: () => openSkill(st, skill.name),
        onMouseEnter: (e) => { e.currentTarget.style.borderColor = C.accent },
        onMouseLeave: (e) => { e.currentTarget.style.borderColor = C.line },
      }, [
        h('div', { key: 'r1', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          h('span', { key: 'n', style: s.name }, '/' + skill.name),
          skill.argumentHint ? h(Badge, { key: 'a' }, '要参数') : null,
          missing ? h(Badge, { key: 'm', tone: 'warn' }, '缺 ' + missing.join('/')) : (deps.length ? h(Badge, { key: 'd' }, '+ ' + deps.length + ' 个一起装') : null),
        ]),
        h('div', { key: 'r2', style: { color: C.dim, marginTop: 3, lineHeight: 1.5 } }, skill.zh || skill.description || ''),
      ])
    }

    const Detail = (props) => {
      const { name, detail, cat } = props
      const [store, set] = bind(props)
      const skill = (cat.skills || []).find((x) => x.name === name) || { name }
      return h('div', null, [
        h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('button', { key: 'b', style: s.btn(), onClick: () => set({ open: null, detail: null }) }, '‹ 全部'),
          h('span', { key: 'n', style: { ...s.name, fontSize: 13 } }, '/' + name),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'i', style: s.btn('primary'), onClick: () => inject(store, '/' + name + (skill.argumentHint ? ' ' : '')) }, '放进输入框'),
        ]),
        h('div', { key: 'sub', style: { color: C.dim, marginBottom: 8, lineHeight: 1.5 } }, skill.zh || skill.description || ''),
        skill.principle ? h('div', { key: 'rule', style: { borderLeft: '2px solid ' + C.accent, paddingLeft: 8, margin: '8px 0', color: C.dim, fontSize: 12 } }, skill.principle.rule) : null,
        (skill.deps || []).length
          ? h('div', { key: 'deps', style: { ...s.faint, margin: '8px 0' } }, '同装：' + skill.deps.map((d) => '/' + d).join('  '))
          : null,
        store.draft ? h('div', { key: 'draft', style: { border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', margin: '8px 0', fontFamily: C.mono, fontSize: 12, background: 'rgba(0,0,0,.2)', userSelect: 'all' } }, store.draft) : null,
        h('div', { key: 'hr', style: { borderTop: '1px solid ' + C.line, margin: '10px 0' } }),
        detail && detail.ok && detail.bodyZh
          ? h('div', { key: 'lang', style: { marginBottom: 6 } }, h('button', {
            style: s.btn(),
            onClick: () => set({ zhOnly: !store.zhOnly }),
          }, store.zhOnly ? '看英文原文' : '这段有中文版，当前显示中文'))
          : null,
        detail === null
          ? h('div', { key: 'load', style: s.faint }, '读正文…')
          : detail && detail.ok
            ? h('div', { key: 'md', style: { fontSize: 12.5 } }, renderMd(detail.bodyZh && !store.zhOnly ? detail.bodyZh : detail.body))
            : h('div', { key: 'err', style: { color: '#f0b132' } }, '读不到这个技能的正文：' + String((detail && (detail.message || detail.error)) || '未知原因')),
      ])
    }

    const Guide = ({ st }) => h('div', { style: { marginBottom: 10 } }, [
      h('div', { key: 't', style: { ...s.faint, margin: '2px 0 6px' } }, '不知道点哪个？按这个顺序走'),
      ...GUIDE.map((step, i) => h('div', {
        key: step.id,
        style: { ...s.card(false), cursor: 'default' },
      }, [
        h('div', { key: 'a', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('span', { key: 'i', style: { ...s.faint, fontFamily: C.mono } }, String(i + 1)),
          h('span', { key: 't', style: { fontWeight: 600 } }, step.title),
          h('div', { key: 's', style: { flex: 1 } }),
          h('button', { key: 'b', style: s.btn('primary'), onClick: () => inject(st, step.inject) }, '用这个'),
        ]),
        h('div', { key: 'w', style: { color: C.dim, marginTop: 3, fontSize: 12 } }, step.when),
      ])),
    ])

    const List = (props) => {
      const { cat } = props
      const [store, set] = bind(props)
      const q = store.q.trim().toLowerCase()
      const rows = (cat.skills || []).filter((sk) => {
        if (store.group !== 'all' && (sk.principle ? sk.principle.group : 'workflow') !== store.group) return false
        if (!q) return true
        return sk.name.includes(q) || String(sk.zh || '').toLowerCase().includes(q) || String(sk.description || '').toLowerCase().includes(q)
      })
      const showGuide = !q && store.group === 'all'
      return h('div', null, [
        showGuide ? h(Guide, { key: 'g', st: store }) : null,
        ...GROUP_ORDER.filter((g) => (cat.groups[g] || []).length).map((g) => {
          const hit = rows.filter((sk) => (sk.principle ? sk.principle.group : 'workflow') === g)
          if (!hit.length) return null
          return h('div', { key: g }, [
            h('div', { key: 'h', style: { ...s.faint, margin: '12px 0 6px', letterSpacing: '.06em' } }, `${GROUP_ZH[g] || g} · ${hit.length}`),
            ...hit.map((sk) => h(SkillRow, { key: sk.name, skill: sk, cat, st: store })),
          ])
        }),
        rows.length ? null : h('div', { key: 'none', style: { ...s.faint, padding: '16px 4px' } }, '没有匹配的技能。'),
      ])
    }

    // ------------------------------------------------------------ 看板

    const KIND_LABEL = { idea: '想法', bug: '缺陷', task: '任务' }
    const STATE_LABEL = { idea: '想法', todo: '待办', doing: '在做', done: '完成', dropped: '已废弃' }
    // 画布上一张卡最多画几条候选命令；全部候选在下钻面板里
    const MAX_GHOSTS = 4
    const STATE_ORDER = ['doing', 'todo', 'idea', 'done', 'dropped']
    // 地图卡正文的四段，和 board.js 的 MAP_SECTIONS 是同一套标题
    const MAP_SECTIONS = [
      { key: 'destination', label: '去向' },
      { key: 'decisions', label: '已经定了' },
      { key: 'fog', label: '还没想清' },
      { key: 'out', label: '不做什么' },
    ]

    // 每个请求都带 sid + cwd：宿主那边按会话反查 cwd 会失败（插件 ctx 里不一定有 sessions 服务），
    // 面板这边从 useSessions 拿到的 cwd 才是准的。
    // 面板手里那版卡带着 at（文件的修改时间）。改它的时候顺手把版本号带上：
    // 盘上要是被人改过，宿主拒写并说清下一步，而不是拿内存里的旧对象把人的改动盖掉。
    const q = (st, extra) => {
      const out = { sessionId: st.sid, cwd: st.cwd, ...extra }
      if (extra && extra.id !== undefined && out.expectedUpdatedAt === undefined) {
        const cards = (st.board && st.board.cards) || []
        const card = cards.find((c) => c.id === Number(extra.id))
        if (card && card.at) out.expectedUpdatedAt = card.at
      }
      return out
    }

    // 剧本列表基本不变（只有上游改仓库才变），取一次缓存住；展开某套时才把它那几步一并带回来
    const loadPlays = async (st, fresh) => {
      if (st.plays && !fresh) return st.plays
      try {
        const r = await rpc('playbooks', {})
        st.set({ plays: r })
        return r
      } catch (e) {
        st.set({ plays: { plays: [], detail: {}, error: String((e && e.message) || e) } })
        return st.plays
      }
    }

    const loadBoard = async (st) => {
      const set = st.set
      try {
        set({ board: await rpc('board', q(st)) })
      } catch (e) {
        set({ toast: '读不到看板：' + String((e && e.message) || e), toastAt: Date.now() })
      }
      try {
        set({ sug: await rpc('suggest', q(st)) })
      } catch (e) {
        set({ sug: null })
      }
      // 在办表是副产物：读不到就不显示，不挡看板
      try {
        set({ work: await rpc('workpath', q(st)) })
      } catch (e) {
        set({ work: null })
      }
    }

    // 版本页。票随 changes 一起来（绑在当前的改动上），点提交/推送必须原样带回。
    const loadGit = async (st, fresh) => {
      st.set({ gitLoading: true })
      try {
        st.set({ git: await rpc('changes', q(st, fresh ? { fresh: true } : {})), gitErr: null, gitLoading: false })
      } catch (e) {
        st.set({ git: null, gitErr: { kind: e.kind || 'unknown', message: e.message, hint: e.hint || '' }, gitLoading: false })
      }
    }

    const LAYER_ZH = { project: '按这个项目推', global: '项目里还没卡，看看别的项目', seed: '先起个头' }

    // 环境自检。fresh=true 只为了绕开版本那一条的 30 秒缓存，其余每项本来就是现读磁盘。
    const loadEnv = async (st, fresh) => {
      st.set({ envLoading: true })
      try {
        st.set({ env: await rpc('env', q(st, fresh ? { fresh: true } : {})), envLoading: false })
      } catch (e) {
        st.set({ envLoading: false, toast: '自检跑不动：' + String((e && e.message) || e), toastAt: Date.now() })
      }
    }

    // 三层决策的结果：3~5 条，每条都带着写好的提示词，点一下就能发
    const Suggest = ({ st }) => {
      const store = st
      const set = st.set
      const sug = store.sug
      if (!sug || !Array.isArray(sug.items) || !sug.items.length) return null
      return h('div', { key: 'sug', style: { marginBottom: 12 } }, [
        h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
          h('span', { key: 't', style: { ...s.faint, fontSize: 11 } }, '建议接下来做这几件 · ' + (LAYER_ZH[sug.layer] || sug.layer)),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'r', style: { ...s.chip(false), fontSize: 10 }, onClick: loadBoard }, '换一批'),
        ]),
        ...(sug.items || []).map((it, i) => {
          const open = store.sugOpen === it.id
          const doIt = async (method, payload, ok) => {
            try {
              const view = await rpc(method, q(store, payload))
              const patch = { board: view, toast: ok, toastAt: Date.now() }
              try {
                patch.sug = await rpc('suggest', q(store))
              } catch {
                /* 建议取不到不影响这次动作 */
              }
              set(patch)
            } catch (e) {
              set({ toast: String((e && e.message) || e), toastAt: Date.now() })
            }
          }
          return h('div', {
            key: it.id || i,
            style: { border: '1px solid ' + (i === 0 ? C.accent : C.line), borderRadius: 8, marginBottom: 6, background: i === 0 ? 'rgba(122,162,247,.10)' : C.card },
          }, [
            // 标题行：点一下展开/收起，展开才看 Jev 分数和能直接粘的命令
            h('div', {
              key: 't',
              style: { padding: '8px 10px', cursor: 'pointer' },
              onClick: () => set({ sugOpen: open ? '' : it.id }),
            }, [
              h('div', { key: 'tt', style: { fontWeight: 600, wordBreak: 'break-word' } },
                (it.cardId && it.kind !== 'direction' ? `#${it.cardId} ` : '')
                + (it.project ? `[${it.project}] ` : '')
                + it.title
                + (it.kind === 'direction' && it.cardId ? `（先从 #${it.cardId} 下手）` : '')),
              h('div', { key: 'm', style: { ...s.faint, fontSize: 10, marginTop: 2 } }, [
                it.urgency != null ? `紧急 ${it.urgency.toFixed(2)}` : '',
                it.certainty != null ? ` · 把握 ${it.certainty.toFixed(2)}` : '',
                it.ask ? ' · 先确认' : '',
                ' · ' + (open ? '收起' : '看命令'),
              ].join('')),
            ]),
            open
              ? h('div', { key: 'x', style: { padding: '0 10px 10px' } }, [
                h('div', { key: 'w', style: { color: C.dim, fontSize: 12, margin: '0 0 6px', lineHeight: 1.5 } }, it.why),
                // Jev 的四个原子问题各自的分，权重在代码里（COEF），这里只展示
                it.factors
                  ? h('div', { key: 'f', style: { ...s.faint, fontSize: 10, marginBottom: 6, lineHeight: 1.6 } },
                    'Jev 分解：' + [
                      `在做 ${it.factors.state.toFixed(2)}×0.45`,
                      `类型 ${it.factors.kind.toFixed(2)}×0.25`,
                      `进展 ${it.factors.progress.toFixed(2)}×0.15`,
                      `新鲜 ${it.factors.fresh.toFixed(2)}×0.15`,
                    ].join(' · '))
                  : null,
                h('div', { key: 'c', style: { fontFamily: C.mono, fontSize: 11, background: 'rgba(0,0,0,.3)', border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', marginBottom: 8, userSelect: 'all', wordBreak: 'break-all' } }, it.prompt),
                h('div', { key: 'a', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } }, [
                  // 点「执行」= 认领 + 注入，一步到位：命令进了输入框，卡也已经在「在做」，
                  // 两边不会一个走一个不动。
                  h('button', {
                    key: 'u',
                    style: s.btn('primary'),
                    onClick: async () => {
                      if (it.cardId && it.state !== 'doing' && !it.ask) {
                        try {
                          await rpc('boardAct', q(store, { id: it.cardId, action: 'claim', owner: store.sid || 'me' }))
                        } catch {
                          /* 被挡着或已有人认领，注入照做 */
                        }
                      }
                      inject(store, it.prompt)
                      loadBoard(store)
                    },
                  }, '执行这条命令'),
                  it.cardId ? h('button', {
                    key: 'd',
                    style: s.btn(),
                    onClick: () => set({ finish: { id: it.cardId, state: 'done' }, finNote: '', sugOpen: '' }),
                  }, '标为完成') : null,
                ]),
                it.cardId ? FinishEditor({ id: it.cardId, call: doIt, st }) : null,
              ])
              : null,
          ])
        }),
      ])
    }

    // 收尾编辑器：完成和废弃都要一句结论才落盘。
    // 这不是形式主义——没有结论的「已完成」，三天后没人知道当时到底做了什么、验没验。
    const FinishEditor = ({ id, call, st }) => {
      const store = st
      const set = st.set
      const fin = store.finish
      if (!fin || fin.id !== id) return null
      const isDrop = fin.state === 'dropped'
      const go = () => {
        const note = store.finNote.trim()
        if (!note) {
          set({ toast: isDrop ? '写一句为什么不做' : '写一句做成了什么', toastAt: Date.now() })
          return
        }
        call('boardAct', { id, action: isDrop ? 'drop' : 'done', note }, isDrop ? '已废弃，可随时重开' : '已完成')
        set({ finish: null, finNote: '' })
      }
      return h('div', { style: { border: '1px solid ' + (isDrop ? C.line : C.accent), borderRadius: 6, padding: 8, marginTop: 6, background: 'rgba(0,0,0,.18)' } }, [
        h('div', { key: 'q', style: { ...s.faint, fontSize: 11, marginBottom: 4 } },
          isDrop ? '为什么放掉？（会记进地图的「不做什么」）' : '做成了什么、验过什么？（会记进地图的「已经定了」）'),
        h('textarea', {
          key: 'n',
          style: { ...s.input, minHeight: 54, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 },
          value: store.finNote,
          placeholder: isDrop ? '这条路走不通，因为…' : '改了 X，跑了 Y，结果是 Z',
          onChange: (e) => set({ finNote: e.target.value }),
        }),
        h('div', { key: 'b', style: { display: 'flex', gap: 6, marginTop: 6 } }, [
          h('button', { key: 'ok', style: s.btn('primary'), onClick: go }, isDrop ? '确认废弃' : '确认完成'),
          h('button', { key: 'no', style: s.btn(), onClick: () => set({ finish: null, finNote: '' }) }, '取消'),
        ]),
      ])
    }

    const Board = ({ st }) => {
      const store = st
      const set = st.set
      const b = store.board
      // 一次动作 = 一次整体刷新：卡片状态和「建议接下来做这几件」必须同一帧更新，
      // 否则卡片落进「完成」但推荐还停在上一条，人就会以为没生效。
      const call = async (method, payload, okText) => {
        try {
          const view = await rpc(method, q(store, payload))
          const patch = { board: view, toast: okText, toastAt: Date.now() }
          try {
            patch.sug = await rpc('suggest', q(store))
          } catch {
            /* 建议取不到不该挡住这次动作 */
          }
          set(patch)
        } catch (e) {
          set({ toast: String((e && e.message) || e), toastAt: Date.now() })
        }
      }
      const add = () => {
        const title = store.idea.trim()
        if (!title) return
        call('boardSave', { title, kind: store.kind }, '已记进看板')
        set({ idea: '' })
      }
      if (!b) return h('div', { style: { ...s.body, ...s.faint } }, '读看板…')

      const all = (b.cards || []).filter((c) => c.kind !== 'map')
      // 过滤器只筛「列表里出现哪些」，KPI 用全量：先把盘子有多大说清楚，再让人收窄
      const f = store.filter || 'open'
      const cards = f === 'all'
        ? all
        : f === 'doing'
          ? all.filter((c) => c.state === 'doing')
          : f === 'done'
            ? all.filter((c) => c.state === 'done' || c.state === 'dropped')
            : all.filter((c) => c.state !== 'done' && c.state !== 'dropped')
      const frontier = new Set(b.frontier || [])
      const open = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped')
      const conflicts = b.conflicts || { pairs: [], unscoped: [], rings: [] }
      // 「可开工」单独成组：前置没做完的不混进来，否则一眼看不出现在能碰哪张
      // 可开工：没被挡、没人认领、还没开工。已经在做的就是「在做」组，不重复列
      const ready = open.filter((c) => !(c.blocked || []).length && !c.owner && c.state !== 'doing')
      const doneRows = cards.filter((c) => c.state === 'done' || (c.state === 'dropped' && store.showDropped))
      const sections = [
        { key: 'ready', label: '可开工', rows: ready },
        ...STATE_ORDER
          .filter((st) => st !== 'idea' && st !== 'todo' && (st !== 'dropped' || store.showDropped))
          .map((st) => ({ key: st, label: STATE_LABEL[st] || st, rows: cards.filter((c) => c.state === st) })),
        { key: 'later', label: '被挡着', rows: open.filter((c) => (c.blocked || []).length) },
      ].filter((x) => x.rows.length)

      const proj = b.project || null
      const initCard = proj && !proj.initialized
        ? h('div', { key: 'init', style: { ...s.card(false), borderColor: '#f0b132', cursor: 'default', marginBottom: 10 } }, [
          h('div', { key: 't', style: { fontWeight: 650, marginBottom: 6 } }, `这个项目还没初始化：${proj.name}`),
          h('div', { key: 'd', style: { color: C.dim, fontSize: 12, lineHeight: 1.65 } }, '初始化只在这个项目里写三样东西，都是能提交进仓库的纯文本：'),
          ...[
            '一张地图卡（去向 / 已经定了 / 还没想清 / 不做什么）放进 .pstack/board/',
            '.pstack/README.md，说明一卡一文件、字段怎么手改',
            `AGENTS.md 里的「## 项目看板」段，让以后每个会话的 agent 开工先看板`,
          ].map((t, i) => h('div', { key: 'l' + i, style: { color: C.dim, fontSize: 12, lineHeight: 1.65 } }, '· ' + t)),
          h('button', { key: 'go', style: { ...s.btn('primary'), marginTop: 8 }, onClick: () => call('init', {}, '初始化好了') }, '初始化这个项目'),
        ])
        : null

      // 看板页自带一份技能清单：只列上面建议里点得到的几个，剩下的收进「全部技能」
      const cat = store.catalog || { skills: [] }
      const bySkill = new Map((cat.skills || []).map((sk) => [sk.name, sk]))
      const picked = [...new Set(((store.sug && store.sug.items) || []).map((it) => it.skill).filter(Boolean))].slice(0, 6)
      const skillList = picked.length
        ? h('div', { key: 'skills', style: { marginBottom: 12 } }, [
          h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
            h('span', { key: 't', style: { ...s.faint, fontSize: 11 } }, '这几件事要用的技能'),
            h('div', { key: 'sp', style: { flex: 1 } }),
            h('button', {
              key: 'all',
              style: { ...s.chip(false), fontSize: 10 },
              onClick: () => set({ view: 'skills' }),
            }, `全部 ${(cat.skills || []).length || ''} 个 →`),
          ]),
          ...picked.map((name) => {
            const sk = bySkill.get(name)
            return h('div', {
              key: name,
              style: { ...s.card(false), cursor: 'default', display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px' },
            }, [
              h('span', { key: 'n', style: { fontFamily: C.mono, fontSize: 11.5, color: C.accent, flex: 'none' } }, '/' + name),
              h('span', { key: 'z', style: { color: C.dim, fontSize: 11.5, flex: 1, minWidth: 0, wordBreak: 'break-word' } },
                (sk && (sk.zh || sk.description)) || ''),
              h('button', { key: 'u', style: { ...s.btn(), padding: '2px 8px', fontSize: 11, flex: 'none' }, onClick: () => inject(store, '/' + name + ' ') }, '用这个'),
            ])
          }),
        ])
        : null

      return h('div', { style: s.body }, [
        h('div', { key: 'proj', style: { ...s.faint, fontSize: 10, marginBottom: 8, wordBreak: 'break-all' } },
          `📁 ${proj ? proj.name : ''} · ${b.root || b.cwd}${proj && proj.rel ? `（当前是它的子目录：${proj.rel}）` : ''}`),
        initCard,
        h(Suggest, { key: 'sug', st: store }),
        skillList,

        h('div', { key: 'add', style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, [
          h('input', {
            key: 'i',
            style: { ...s.input, flex: 1, minWidth: 140 },
            placeholder: '一句话：想法 / 缺陷 / 要做的事',
            value: store.idea,
            onChange: (e) => set({ idea: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') add() },
          }),
          h('select', {
            key: 'k',
            style: { ...s.input, width: 'auto', flex: 'none' },
            value: store.kind,
            onChange: (e) => set({ kind: e.target.value }),
          }, Object.entries(KIND_LABEL).map(([k, v]) => h('option', { key: k, value: k }, v))),
          h('button', { key: 'b', style: s.btn('primary'), onClick: add }, '记下'),
        ]),

        h('div', { key: 'where', style: { ...s.faint, fontSize: 10, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: b.dir }, '看板存在 ' + (b.cwd || '?')),
        h('div', { key: 'meta', style: { ...s.faint, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' } }, [
          h('span', { key: 'c' }, `开着 ${open.length} 张 · 共 ${cards.length} 张`),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'f', style: { ...s.chip(store.flow), fontSize: 10 }, onClick: () => set({ flow: !store.flow }) }, store.flow ? '列表' : '流程'),
          h('button', { key: 'd', style: { ...s.chip(store.showDropped), fontSize: 10 }, onClick: () => set({ showDropped: !store.showDropped }) }, '已废弃'),
          h('button', { key: 'r', style: { ...s.chip(false), fontSize: 10 }, onClick: loadBoard }, '重读'),
        ]),

        // 地图：这次要去哪、已经定了什么、还有什么糊着
        b.map ? h('div', { key: 'map', style: { ...s.card(false), borderColor: C.accent, marginBottom: 10 } }, [
          h('div', { key: 'h', style: { display: 'flex', gap: 6, alignItems: 'baseline' } }, [
            h('span', { key: 't', style: { fontWeight: 650 } }, '🗺 ' + b.map.title),
            h('span', { key: 'n', style: { ...s.faint, fontSize: 10 } }, `#${b.map.id} · 挂 ${b.map.children} 张`),
          ]),
          ...MAP_SECTIONS.map(({ key, label }) => (b.map.sections && b.map.sections[key]
            ? h('div', { key, style: { marginTop: 6, fontSize: 12, lineHeight: 1.55 } }, [
              h('span', { key: 'l', style: { ...s.faint, fontSize: 10, display: 'block' } }, label),
              h('span', { key: 'v', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, b.map.sections[key]),
            ])
            : null)),
        ]) : null,

        // 依赖成环：环里的卡谁都开不了工，比并行冲突更硬
        (conflicts.rings || []).length
          ? h('div', { key: 'cy', style: { border: '1px solid #f7768e', borderRadius: 6, padding: '6px 8px', marginBottom: 10, color: '#f7768e', fontSize: 12, lineHeight: 1.55 } },
            '⚠ 依赖成环：' + conflicts.rings.map((r) => r.map((id) => '#' + id).join(' → ')).join('；') + '。挑一环里的一张，把「等谁 / 父卡」改成环外的卡。')
          : null,

        // 并行冲突：同一块路径被两张在做的卡同时改
        conflicts.pairs.length
          ? h('div', { key: 'cf', style: { border: '1px solid #f0b132', borderRadius: 6, padding: '6px 8px', marginBottom: 10, color: '#f0b132', fontSize: 12, lineHeight: 1.55 } },
            '⚠ 并行冲突：' + conflicts.pairs.map((p) => `#${p.a} 与 #${p.b} 都要动 ${p.paths.join('、')}`).join('；') + '。先串行，别同时改。')
          : null,

        // 一眼看盘子：几张没开、几张在做、几张结掉。数字从全量算，跟着过滤器缩水会骗人
        h('div', { key: 'kpi', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 } }, [
          ...[['open', open.length, '待办'], ['doing', all.filter((c) => c.state === 'doing').length, '在做'], ['done', all.filter((c) => c.state === 'done').length, '已结']]
            .filter(([, n]) => n > 0 || true)
            .map(([k, n, label]) => h('button', {
              key: k,
              style: { ...s.chip(f === k), padding: '1px 8px', fontSize: 10.5 },
              onClick: () => set({ filter: k }),
            }, `${label} ${n}`)),
          h('button', { key: 'all', style: { ...s.chip(f === 'all'), padding: '1px 8px', fontSize: 10.5 }, onClick: () => set({ filter: 'all' }) }, `全部 ${all.length}`),
          h('span', { key: 'f', style: { ...s.faint, fontSize: 10, marginLeft: 'auto' } },
            b.stamp ? (b.stamp.freshness === 'fresh' ? '刚读的盘' : b.stamp.freshness === 'failed' ? '读失败，给的是旧底' : `缓存 ${Math.round(b.stamp.ageMs / 1000)} 秒`) : ''),
        ]),

        // 在办表：谁在做哪张卡。跨会话可见——别人的会话在做什么，这里看得见
        store.work && (store.work.entries || []).length
          ? h('div', { key: 'wk', style: { border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', marginBottom: 10 } }, [
            h('div', { key: 'h', style: { ...s.faint, fontSize: 10, marginBottom: 3 } },
              `在办 ${store.work.entries.length} 条${store.work.missing ? '（账本还没建）' : ''}`),
            ...store.work.entries.slice(0, 6).map((e) => h('div', { key: e.sessionId + e.cardId, style: { fontSize: 11, color: C.dim, lineHeight: 1.6, wordBreak: 'break-word' } },
              `${String(e.sessionId).slice(0, 8)} · #${e.cardId} ${e.title || '（没标题）'} · ${STATE_LABEL[e.state] || e.state} · ${e.stale ? '旧' : Math.round(e.age / 60000) + ' 分钟前'}`)),
            store.work.entries.length > 6
              ? h('div', { key: 'more', style: { ...s.faint, fontSize: 10 } }, `还有 ${store.work.entries.length - 6} 条`) : null,
          ])
          : null,

        store.flow ? h(Flow, { key: 'flow', st: store }) : null,
        ...(store.flow ? [] : sections).map(({ key: st, label, rows }) => h('div', { key: st }, [
          h('div', { key: 'h', style: { ...s.faint, margin: '10px 0 6px', letterSpacing: '.06em' } }, `${label || STATE_LABEL[st] || st} · ${rows.length}`),
          ...rows.map((c) => h('div', { key: c.id, style: { ...s.card(false), cursor: 'default' } }, [
            h('div', { key: 'a', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'i', style: { ...s.faint, fontFamily: C.mono, flex: 'none' } }, '#' + c.id),
              h('span', { key: 't', style: { fontWeight: 600, minWidth: 0, wordBreak: 'break-word' } }, c.title),
              h('div', { key: 'sp', style: { flex: 1 } }),
              c.owner ? h('span', { key: 'o', style: { ...s.faint, fontSize: 10, flex: 'none', color: C.accent } }, '👤 ' + String(c.owner).slice(0, 8)) : null,
              h('span', { key: 'k', style: { ...s.faint, fontSize: 10, flex: 'none' } }, KIND_LABEL[c.kind] || c.kind),
            ]),
            c.body && c.body.trim() ? h('div', { key: 'b', style: { color: C.dim, fontSize: 12, marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, c.body.trim()) : null,
            (() => {
              const sug = (store.sug && store.sug.items || []).find((x) => x.cardId === c.id)
              const n = (c.candidates || []).length
              const head = sug
                ? `主推 /${sug.skill} · 紧急 ${sug.urgency != null ? sug.urgency.toFixed(2) : '?'} · 把握 ${sug.certainty != null ? sug.certainty.toFixed(2) : '?'}${sug.ask ? ' · 先确认' : ''}`
                : ''
              const more = n > 1 ? ` · 还有 ${n - 1} 条走法` : ''
              const play = c.playbook ? `剧本 ${c.playTitle || c.playbook} 第 ${c.step || 1}${c.playSteps ? '/' + c.playSteps : ''} 步 · ` : ''
              return head || play ? h('div', { key: 'sug', style: { ...s.faint, fontSize: 10, marginTop: 4 } }, play + head + more) : null
            })(),
            h('div', { key: 'n', style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, [
              c.next ? h('button', { key: 'u', style: { ...s.btn('primary'), padding: '2px 8px', fontSize: 11 }, onClick: () => inject(store, '/' + c.next.skill + ' ' + c.title) }, '/' + c.next.skill) : null,
              c.state === 'done' || c.state === 'dropped'
                ? h('button', { key: 're', style: { ...s.btn(), padding: '2px 8px', fontSize: 11 }, onClick: () => call('boardAct', { id: c.id, action: 'reopen', note: '再试一次' }, '已重开，回到待办') }, '重开')
                : null,
              c.state !== 'done' && c.state !== 'dropped' && !c.owner && !(c.blocked || []).length
                ? h('button', { key: 'c', style: { ...s.btn('primary'), padding: '2px 8px', fontSize: 11 }, onClick: () => call('boardAct', { id: c.id, action: 'claim', owner: store.sid || 'me' }, '这张归你了') }, '我来做')
                : null,
              (c.blocked || []).length ? h('span', { key: 'w', style: { ...s.faint, fontSize: 10 } }, `等 #${c.blocked.join(' #')}`) : null,
              c.owner && c.state !== 'done' && c.state !== 'dropped'
                ? h('button', { key: 'r', style: { ...s.btn(), padding: '2px 8px', fontSize: 11 }, onClick: () => call('boardAct', { id: c.id, action: 'release' }, '已交回') }, '交回')
                : null,
              c.state !== 'done' && c.state !== 'dropped'
                ? h('button', { key: 'f', style: { ...s.btn(), padding: '2px 8px', fontSize: 11 }, onClick: () => set({ finish: { id: c.id, state: 'done' }, finNote: '' }) }, '完成')
                : null,
              c.state !== 'done' && c.state !== 'dropped'
                ? h('button', { key: 'x', style: { ...s.btn(), padding: '2px 8px', fontSize: 11, color: C.faint }, onClick: () => set({ finish: { id: c.id, state: 'dropped' }, finNote: '' }) }, '废弃')
                : null,
              c.progress ? h('span', { key: 'p', style: { ...s.faint, fontSize: 10 } }, c.progress + ' 条进展') : null,
            ]),
            FinishEditor({ id: c.id, call, st: store }),
          ])),
        ])),
      ])
    }

    // 剧本视图：pstack 的技能之间没有硬顺序，顺序在 22 套剧本里。
    // 这里把步骤摊开，每步点名的技能可以直接注入；也能拿某一步开一张卡，
    // 卡上记住 playbook+step，之后拓扑里的「下一步」就按这套剧本走。
    const Plays = ({ st }) => {
      const store = st
      const set = st.set
      const r = store.plays
      if (!r) return h('div', { style: { ...s.body, ...s.faint } }, '读剧本…')
      if (r.error) return h('div', { style: { ...s.body, color: '#f0b132' } }, '读不到剧本：' + r.error)
      const cat = store.catalog || { skills: [] }
      const byName = new Map((cat.skills || []).map((sk) => [sk.name, sk]))
      const rows = (r.plays || []).filter((p) => p.steps > 0)
      const openSlug = store.openPlay
      if (!openSlug) {
        return h('div', { style: s.body }, [
          h('div', { key: 'h', style: { ...s.faint, fontSize: 10, marginBottom: 8, lineHeight: 1.6 } },
            '技能之间没有先后。先后在剧本里：一套剧本 = 一串编号步骤，每步点名这一步该用哪些技能。'),
          ...rows.map((p) => h('div', {
            key: p.slug,
            style: { ...s.card(false) },
            onClick: () => set({ openPlay: p.slug }),
          }, [
            h('div', { key: 't', style: { display: 'flex', gap: 6, alignItems: 'baseline' } }, [
              h('span', { key: 'n', style: { flex: 1, fontWeight: 600, fontSize: 12.5 } }, p.title || p.slug),
              h('span', { key: 'c', style: { ...s.faint, fontSize: 10, fontFamily: C.mono } }, `${p.steps} 步`),
            ]),
            h('div', { key: 's', style: { ...s.faint, fontSize: 10.5, fontFamily: C.mono, marginTop: 3, wordBreak: 'break-all' } },
              (p.skills || []).slice(0, 4).map((x) => '/' + x).join('  ') + ((p.skills || []).length > 4 ? ' …' : '')),
          ])),
        ])
      }
      const steps = (r.detail && r.detail[openSlug]) || []
      const meta = rows.find((p) => p.slug === openSlug) || { title: openSlug, slug: openSlug }
      return h('div', { style: s.body }, [
        h('div', { key: 'back', style: { marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' } }, [
          h('button', { key: 'b', style: { ...s.btn(), padding: '2px 8px', fontSize: 11 }, onClick: () => set({ openPlay: '' }) }, '← 全部剧本'),
          h('span', { key: 't', style: { flex: 1, fontWeight: 650, fontSize: 12.5, minWidth: 0 } }, meta.title || meta.slug),
        ]),
        ...steps.map((step) => h('div', { key: step.n, style: { ...s.card(false), cursor: 'default' } }, [
          h('div', { key: 'h', style: { display: 'flex', gap: 6, alignItems: 'baseline' } }, [
            h('span', { key: 'n', style: { fontFamily: C.mono, fontSize: 11, color: C.accent, flex: 'none' } }, `${step.n}.`),
            h('span', { key: 't', style: { flex: 1, fontSize: 11.5, color: C.dim, lineHeight: 1.55, wordBreak: 'break-word' } },
              step.text.length > 160 ? step.text.slice(0, 158) + '…' : step.text),
          ]),
          (step.skills || []).length
            ? h('div', { key: 'sk', style: { marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 } },
              step.skills.map((name) => h('button', {
                key: name,
                style: { ...s.chip(false), fontSize: 10, fontFamily: C.mono },
                title: (byName.get(name) && (byName.get(name).zh || byName.get(name).description)) || '',
                onClick: () => inject(store, '/' + name + ' '),
              }, '/' + name)))
            : null,
          h('div', { key: 'a', style: { marginTop: 5 } }, h('button', {
            key: 'card',
            style: { ...s.btn(), padding: '2px 8px', fontSize: 10.5 },
            title: '开一张卡，把这一步当成它的当前步骤：之后拓扑里这块的下一步就按这套剧本走',
            onClick: async () => {
              const title = `${meta.title || meta.slug} · 第 ${step.n} 步`
              try {
                const view = await rpc('boardSave', q(store, { title, kind: 'task', playbook: meta.slug, step: step.n }))
                const patch = { board: view, view: 'board', toast: `已开卡：${title}`, toastAt: Date.now() }
                try {
                  patch.sug = await rpc('suggest', q(store))
                } catch {
                  /* 建议取不到不影响开卡 */
                }
                set(patch)
              } catch (e) {
                set({ toast: String((e && e.message) || e), toastAt: Date.now() })
              }
            },
          }, '用这一步开卡')),
        ])),
      ])
    }

    const STATE_COLOR = {
      doing: C.accent,
      todo: '#8aa0c8',
      idea: '#6b7280',
      done: '#4caf7d',
      dropped: '#5b5b5b',
    }

    // 下钻：点图上一格，看这张卡现在到哪、下一步怎么做、以及「完结」的入口
    const NodeDetail = ({ id, st }) => {
      const store = st
      const set = st.set
      const card = ((store.board && store.board.cards) || []).find((c) => c.id === Number(id))
      if (!card) return null
      const it = ((store.sug && store.sug.items) || []).find((x) => x.cardId === card.id)
      // 这张卡能有几条路：宿主算好的候选（剧本步骤 + 决策模型 + 同类走法），主推排第一
      const cands = (card.candidates && card.candidates.length) ? card.candidates : (it ? [it] : [])
      const skill = (it && it.skill) || (card.next && card.next.skill)
      const why = (it && it.why) || (card.next && card.next.why) || ''
      const prompt = it ? it.prompt : skill ? '/' + skill + ' #' + card.id + ' ' + card.title : ''
      const go = async (method, payload, ok) => {
        try {
          set({ board: await rpc(method, q(store, payload)), toast: ok, toastAt: Date.now() })
          set({ node: null })
          loadBoard(store)
        } catch (e) {
          set({ toast: String((e && e.message) || e), toastAt: Date.now() })
        }
      }
      const act = (action, note) => go('boardAct', { id: card.id, action, note })
      const closing = card.state === 'done' || card.state === 'dropped'
      return h('div', { style: { border: '1px solid ' + C.accent, borderRadius: 8, padding: '8px 10px', marginTop: 8, background: 'rgba(122,162,247,.10)' } }, [
        h('div', { key: 't', style: { fontWeight: 600, wordBreak: 'break-word' } }, `#${card.id} ${card.title}`),
        h('div', { key: 'm', style: { ...s.faint, fontSize: 10, marginTop: 2 } }, [
          (KIND_LABEL[card.kind] || card.kind) + ' · ' + (STATE_LABEL[card.state] || card.state),
          card.owner ? ' · 👤 ' + card.owner : '',
          card.scope && card.scope.length ? ' · 动 ' + card.scope.join(' ') : '',
          card.playbook ? ` · 剧本 ${card.playbook} 第 ${card.step || 1}/${card.playSteps || '?'} 步` : '',
          card.blocked && card.blocked.length ? ' · 等 #' + card.blocked.join(' #') : '',
        ].join('')),
        why ? h('div', { key: 'w', style: { color: C.dim, fontSize: 12, margin: '4px 0' } }, (skill ? `下一步 /${skill}：` : '') + why) : null,
        it && it.urgency != null
          ? h('div', { key: 'j', style: { ...s.faint, fontSize: 10, marginBottom: 6 } },
            `Jev：紧急 ${it.urgency.toFixed(2)} · 把握 ${it.certainty.toFixed(2)}${it.ask ? ' · 先确认' : ''}`)
          : null,
        cands.length > 1
          ? h('div', { key: 'cs', style: { margin: '2px 0 8px' } }, cands.map((c, i) => h('div', {
            key: c.skill + i,
            style: { display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0' },
          }, [
            h('span', { key: 'n', style: { fontFamily: C.mono, fontSize: 11, color: i ? C.dim : C.accent, flex: 'none' } },
              (i ? '→ ' : '★ ') + '/' + c.skill),
            h('span', { key: 'w', style: { ...s.faint, fontSize: 10.5, flex: 1, minWidth: 0, wordBreak: 'break-word' } }, c.why || ''),
            c.ask
              ? h('button', { key: 'b', style: { ...s.btn(), padding: '1px 6px', fontSize: 10 }, onClick: () => set({ node: null }) }, '先看清')
              : h('button', { key: 'b', style: { ...s.btn(), padding: '1px 6px', fontSize: 10 }, onClick: () => inject(store, c.prompt) }, '用这条'),
          ])))
          : h('div', { key: 'cw', style: { ...s.faint, fontSize: 10, margin: '2px 0 8px' } }, '这条路只有一条：按上面那条走。'),
        prompt
          ? h('div', { key: 'c', style: { fontFamily: C.mono, fontSize: 11, background: 'rgba(0,0,0,.3)', border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', marginBottom: 8, userSelect: 'all', wordBreak: 'break-all' } }, prompt)
          : null,
        h('div', { key: 'a', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          prompt ? h('button', { key: 'u', style: s.btn('primary'), onClick: () => inject(store, prompt) }, '执行这条命令') : null,
          card.state !== 'doing' && !closing && !(card.blocked || []).length
            ? h('button', { key: 's', style: s.btn(), onClick: () => act('claim', undefined) }, '我来做')
            : null,
          card.owner && !closing
            ? h('button', { key: 's2', style: s.btn(), onClick: () => act('release') }, '交回')
            : null,

          closing
            ? h('button', { key: 're', style: s.btn('primary'), onClick: () => act('reopen', '再试一次') }, '重开')
            : h('button', { key: 'd', style: s.btn(), onClick: () => set({ finish: { id: card.id, state: 'done' }, finNote: '' }) }, '标记完成'),
          closing
            ? null
            : h('button', { key: 'x', style: { ...s.btn(), color: C.faint }, onClick: () => set({ finish: { id: card.id, state: 'dropped' }, finNote: '' }) }, '废弃'),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'c0', style: { ...s.btn(), color: C.faint }, onClick: () => set({ node: null }) }, '收起'),
        ]),
        FinishEditor({ id: card.id, call: go, st: store }),
      ])
    }

    // 拓扑：一列一层，连线指向前置 → 后继；废弃的画虚线、单列到底
    const Flow = ({ st }) => {
      const store = st
      const set = st.set
      const g = store.board && store.board.graph
      if (!g || !g.nodes.length) return h('div', { style: { ...s.faint, padding: '4px 0' } }, '还没有卡')
      const cards = (store.board && store.board.cards) || []
      const COL = 136
      const W = 124
      const H = 40
      const GH = 18 // 每格预期线路的高度
      const COL_GAP = 20 // 节点底部到第一格预期线路
      const zoom = store.zoom || 1

      // 每张卡下面的预期线路格数：1~5 条候选命令 + 一格「完成」。
      // 行高按最多的那张算，同一列才不会叠在一起。
      const candOf = (id) => {
        const card = cards.find((c) => c.id === id) || {}
        const it = ((store.sug && store.sug.items) || []).filter((x) => x.cardId === id)
        if (card.candidates && card.candidates.length) return card.candidates
        if (it.length) return it
        if (card.next && card.next.skill) return [{ skill: card.next.skill, why: card.next.why, prompt: '/' + card.next.skill + ' #' + id + ' ' + card.title }]
        return []
      }
      const liveNodes = g.nodes.filter((n) => n.state !== 'done' && n.state !== 'dropped')
      const ghostRows = (n) => {
        const card = cards.find((c) => c.id === n.id) || {}
        if ((card.blocked || []).length) return 1
        return Math.max(1, Math.min(MAX_GHOSTS, candOf(n.id).length)) + 1
      }
      const rowOf = new Map()
      for (const n of g.nodes) rowOf.set(n.id, n.state === 'done' || n.state === 'dropped' ? 0 : ghostRows(n) * GH + COL_GAP)

      const colIdx = new Map()
      const colY = new Map()
      const pos = new Map()
      for (const n of g.nodes) {
        const i = colIdx.get(n.depth) ?? 0
        colIdx.set(n.depth, i + 1)
        const y = (colY.get(n.depth) ?? 8) + (i ? 0 : 0)
        pos.set(n.id, { x: 8 + n.depth * COL, y })
        colY.set(n.depth, y + H + 12 + (rowOf.get(n.id) || 0))
      }
      const stacksBottom = Math.max(...[...pos.values()].map((p) => p.y + H + 60), 100)
      const width = 16 + (g.depthMax + 1) * COL
      const height = 24 + stacksBottom
      const nodes = g.nodes.map((n) => {
        const p = pos.get(n.id)
        const color = STATE_COLOR[n.state] || '#6b7280'
        const label = String(n.title).length > 9 ? String(n.title).slice(0, 8) + '…' : String(n.title)
        const card = cards.find((c) => c.id === n.id) || {}
        return h('g', { key: n.id, onClick: () => set({ node: store.node === n.id ? null : n.id }), style: { cursor: 'pointer' } }, [
          h('title', { key: 'ti' }, '#' + n.id + ' ' + n.title + (card.playbook ? `（剧本 ${card.playbook} 第 ${card.step || 1} 步）` : '')),
          h('rect', {
            key: 'r',
            x: p.x, y: p.y, width: W, height: H, rx: 6,
            fill: 'rgba(0,0,0,.25)', stroke: color, strokeWidth: n.state === 'doing' ? 2 : 1,
            strokeDasharray: n.state === 'dropped' ? '4 3' : undefined,
            opacity: n.state === 'dropped' || n.state === 'done' ? 0.55 : 1,
          }),
          h('text', { key: 'i', x: p.x + 6, y: p.y + 14, fill: color, fontSize: 9, fontFamily: C.mono }, '#' + n.id + (card.owner ? ' 👤' : '')),
          h('text', { key: 't', x: p.x + 6, y: p.y + 30, fill: C.fg, fontSize: 10.5 }, label),
        ])
      })

      // 预期线路：每张没做完的卡先列 1~5 条候选命令（决策模型给的，主推排第一），
      // 最后再列一格「完成」。画布上最多 MAX_GHOSTS 条，全部在下钻面板里。
      const ghosts = []
      for (const n of liveNodes) {
        const p = pos.get(n.id)
        const card = cards.find((c) => c.id === n.id) || {}
        if ((card.blocked || []).length) {
          ghosts.push(h('g', { key: 'gw' + n.id, style: { cursor: 'default' } }, [
            h('rect', {
              key: 'r', x: p.x, y: p.y + H + 4, width: W, height: 15, rx: 4,
              fill: 'rgba(255,255,255,.03)', stroke: '#3a3f4b', strokeWidth: 1, strokeDasharray: '2 3',
            }),
            h('text', { key: 't', x: p.x + 5, y: p.y + H + 15, fill: '#6b7280', fontSize: 9, fontFamily: C.mono }, '⏳ 等 #' + card.blocked.join(' #')),
          ]))
          continue
        }
        const cands = candOf(n.id).slice(0, MAX_GHOSTS)
        cands.forEach((c, i) => {
          const label = (i ? '→ ' : '★ ') + '/' + c.skill
          ghosts.push(h('g', {
            key: 'g' + n.id + i,
            onClick: () => (c.ask ? set({ node: n.id }) : inject(store, c.prompt || '/' + c.skill + ' #' + n.id + ' ' + n.title)),
            style: { cursor: 'pointer' },
          }, [
            h('title', { key: 'ti' }, (i ? '也可以' : '主推') + '：' + (c.why || '') + '\n' + (c.prompt || '')),
            h('rect', {
              key: 'r',
              x: p.x, y: p.y + H + 4 + i * GH, width: W, height: 15, rx: 4,
              fill: i ? 'rgba(122,162,247,.05)' : 'rgba(122,162,247,.13)', stroke: i ? '#3f4a5c' : '#6b82a8',
              strokeWidth: 1, strokeDasharray: '3 3',
            }),
            h('text', {
              key: 't', x: p.x + 5, y: p.y + H + 15 + i * GH,
              fill: i ? '#7f93b5' : '#a9c0e8', fontSize: 9.5, fontFamily: C.mono,
            }, label),
          ]))
        })
        const fy = p.y + H + 4 + cands.length * GH
        ghosts.push(h('g', { key: 'gf' + n.id, onClick: () => set({ node: n.id }), style: { cursor: 'pointer' } }, [
          h('title', { key: 'ti' }, '把它标为完成'),
          h('rect', {
            key: 'r', x: p.x, y: fy, width: W, height: 15, rx: 4,
            fill: 'rgba(76,175,125,.08)', stroke: '#3f6a55', strokeWidth: 1, strokeDasharray: '3 3',
          }),
          h('text', { key: 't', x: p.x + 5, y: fy + 11, fill: '#7fb99a', fontSize: 9.5, fontFamily: C.mono }, '✓ 完成 #' + n.id),
        ]))
      }

      const edges = g.edges.map((e) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        const x1 = a.x + W
        const y1 = a.y + H / 2
        const x2 = b.x
        const y2 = b.y + H / 2
        const mid = (x1 + x2) / 2
        const target = cards.find((c) => c.id === e.to)
        const dropped = target && target.state === 'dropped'
        return h('path', {
          key: 'e' + e.from + '-' + e.to,
          d: `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
          fill: 'none',
          stroke: dropped ? '#5b5b5b' : '#7a9bd0',
          strokeWidth: 1.6,
          strokeDasharray: dropped ? '4 3' : undefined,
        })
      })

      // 画布：不占死页面。容器限高 + 双向滚动 + 按住拖 + 缩放按钮。
      // 拖动靠 scrollLeft/Top，不加新依赖，也不会和里面的点击打架（移动超过 3px 才算拖）。
      const pan = React.useRef(null)
      const onDown = (e) => {
        pan.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, moved: false }
      }
      const onMove = (e) => {
        const p0 = pan.current
        if (!p0) return
        const dx = e.clientX - p0.x
        const dy = e.clientY - p0.y
        if (!p0.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        p0.moved = true
        e.currentTarget.scrollLeft = p0.left - dx
        e.currentTarget.scrollTop = p0.top - dy
      }
      const onUp = () => { pan.current = null }

      const legend = ['doing', 'todo', 'idea', 'done', 'dropped'].map((st) => h('span', {
        key: st,
        style: { color: STATE_COLOR[st], fontSize: 10, marginRight: 8 },
      }, '■ ' + (STATE_LABEL[st] || st)))
      return h('div', {}, [
        h('div', { key: 'lg', style: { ...s.faint, margin: '2px 0 6px', display: 'flex', alignItems: 'center' } }, [
          h('span', { key: 'l', style: { flex: 1 } }, legend),
          h('button', { key: 'zo', style: { ...s.btn(), padding: '1px 6px', fontSize: 11 }, onClick: () => set({ zoom: Math.max(0.5, Math.round((zoom - 0.15) * 100) / 100) }), title: '缩小' }, '−'),
          h('span', { key: 'zz', style: { ...s.faint, fontFamily: C.mono, fontSize: 10, margin: '0 4px' } }, Math.round(zoom * 100) + '%'),
          h('button', { key: 'zi', style: { ...s.btn(), padding: '1px 6px', fontSize: 11 }, onClick: () => set({ zoom: Math.min(1.8, Math.round((zoom + 0.15) * 100) / 100) }), title: '放大' }, '+'),
          h('button', { key: 'zr', style: { ...s.btn(), padding: '1px 6px', fontSize: 11, marginLeft: 4 }, onClick: () => set({ zoom: 1 }), title: '回到 100%' }, '100%'),
        ]),
        h('div', {
          key: 'svg',
          onMouseDown: onDown,
          onMouseMove: onMove,
          onMouseUp: onUp,
          onMouseLeave: onUp,
          style: {
            maxHeight: 340, overflow: 'auto', cursor: 'grab', paddingBottom: 4,
            border: '1px solid ' + C.line, borderRadius: 6, background: 'rgba(0,0,0,.12)',
          },
        }, h('svg', {
          width: Math.round(width * zoom),
          height: Math.round(height * zoom),
          viewBox: `0 0 ${width} ${height}`,
          style: { display: 'block' },
        }, [...edges, ...nodes, ...ghosts])),
        h('div', { key: 'h', style: { ...s.faint, fontSize: 10, marginTop: 4 } }, '点一格看这张卡下一步怎么走；虚线格是预期线路：★ 是决策模型的主推，→ 是其它走法，最后那格是完成。按住画布可拖动，± 缩放。'),
        store.node ? h(NodeDetail, { key: 'nd', id: store.node, st: store }) : null,
      ])
    }

    // 环境自检：竞品 INIT FLOW 的第 6 步。每一项都写着「怎么补」，
    // 因为它回答的是「我怎么才能恢复正常」，不是一个红叉清单。
    const CHAIN_ZH = { done: '过了', current: '现在', fail: '卡住', pending: '等前面' }
    const CHAIN_C = { done: C.faint, current: '#7aa2f7', fail: '#f85149', pending: '#6b7089' }

    /** 环境页的动作一落地就必须重查：动作的成败只有下一次自检说了算。 */
    const doEnvAction = async (st, a) => {
      const set = st.set
      try {
        if (a.type === 'refresh') return loadEnv(st, true)
        if (a.type === 'rpc') {
          await rpc(a.method, q(st))
          loadEnv(st, true)
          return
        }
        if (a.type === 'inject-prompt') return inject(st, a.prompt || '')
        if (a.type === 'open-url') {
          try {
            if (typeof window !== 'undefined' && window.open) {
              window.open(a.url, '_blank', 'noopener')
              return set({ toast: '已交给浏览器打开', toastAt: Date.now() })
            }
          } catch {
            /* 掉到复制 */
          }
          if (navigator.clipboard) {
            navigator.clipboard.writeText(a.url)
          }
          return set({ toast: '打不开浏览器，链接已复制：' + a.url, toastAt: Date.now() })
        }
        set({ toast: '这一步还没做成按钮：照着「怎么补」手动做一次', toastAt: Date.now() })
      } catch (e) {
        set({ toast: String((e && e.message) || e), toastAt: Date.now() })
      }
    }

    const ENV_MARK = { ok: '✓', warn: '!', fail: '✕', skip: '·' }
    const ENV_C = { ok: '#3fb950', warn: '#f0b132', fail: '#f85149', skip: C.faint }
    const ENV_ZH = { ok: '正常', warn: '要补', fail: '坏了', skip: '没查' }

    const Env = ({ st }) => {
      const env = st.env
      if (!env) return h('div', { style: { ...s.body, ...s.faint } }, st.envLoading ? '自检…' : '还没自检过')
      const when = new Date(env.at)
      const hh = [when.getHours(), when.getMinutes(), when.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
      const title = env.health === 'fail'
        ? `${env.summary.fail} 项坏了`
        : env.summary.warn ? `${env.summary.warn} 项要补` : '都正常'
      return h('div', { style: s.body }, [
        h('div', { key: 't', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('span', { key: 's', style: { fontWeight: 600, flex: 'none' } }, title),
          h('span', { key: 'w', style: { ...s.faint, fontSize: 10, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${env.project.name || '?'} · 查于 ${hh}`),
          h('button', {
            key: 'r',
            style: { ...s.btn(), padding: '2px 8px', fontSize: 11, flex: 'none' },
            disabled: !!st.envLoading,
            onClick: () => loadEnv(st, true),
          }, st.envLoading ? '自检中…' : '重新检测'),
        ]),
        env.rows.map((r) => h('div', { key: r.key, style: { ...s.card(false), cursor: 'default' } }, [
          h('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, [
            h('span', { key: 'm', style: { color: ENV_C[r.state], flex: 'none', fontWeight: 700 } }, ENV_MARK[r.state] || '·'),
            h('span', { key: 'l', style: { fontWeight: 550, flex: 'none' } }, r.label),
            r.chain
              ? h('span', { key: 'ch', style: { color: CHAIN_C[r.chain] || C.faint, fontSize: 10, flex: 'none' } }, CHAIN_ZH[r.chain] || '')
              : null,
            h('span', { key: 'z', style: { ...s.faint, fontSize: 10, flex: 'none' } }, ENV_ZH[r.state] || ''),
            h('span', { key: 'd', style: { color: C.dim, fontSize: 11, flex: 1, minWidth: 0, wordBreak: 'break-word' } }, r.detail),
          ]),
          r.hint ? h('div', { key: 'p', style: { ...s.faint, fontSize: 10.5, marginTop: 3, lineHeight: 1.5 } }, '怎么补：' + r.hint) : null,
          // 修法就在这一行上：六项是链，链头没修之前后面的按钮亮着也没用，所以按 chain 禁用
          (r.actions || []).length
            ? h('div', { key: 'a', style: { display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' } },
              r.actions.map((a) => h('button', {
                key: a.type + (a.label || ''),
                style: { ...s.btn(), padding: '2px 8px', fontSize: 11, opacity: r.chain === 'pending' ? 0.5 : 1 },
                disabled: r.chain === 'pending',
                title: r.chain === 'pending' ? `先修前面的 #${r.blockedBy ?? '?'}` : '',
                onClick: () => doEnvAction(st, a),
              }, a.label || a.type)))
            : null,
        ])),
        h('div', { key: 'n', style: { ...s.faint, fontSize: 10, marginTop: 4, lineHeight: 1.6 } },
          '这几项都是现读磁盘，没有缓存要走。点「重新检测」就是重查一遍；改完文件不用重启宿主，刷新这一页就够。'),
      ])
    }

    // 版本页：改动、提交、推送。三件事共用一条纪律——先看现场，拿到票，再动手；
    // 票绑在「你看到的那份改动」上，现场一变就作废。没有票的提交/推送在宿主那边直接拒。
    const GIT_MARK = { M: '改', A: '新', D: '删', R: '名', C: '拷', '??': '未跟踪', U: '冲', T: '型' }
    const KIND_ZH = { conflict: '现场变了', env: '环境不对', auth: '要凭据', network: '网不通', unsupported: '这一步做不了', permission: '没权限', parse: '读不出来', not_found: '找不到', unknown: '失败' }

    const Version = ({ st }) => {
      const set = st.set
      const err = st.gitErr
      const g = st.git
      const act = async (method, payload, okText) => {
        set({ commitBusy: true })
        try {
          const r = await rpc(method, q(st, payload))
          set({ commitBusy: false, toast: okText(r), toastAt: Date.now(), commitMsg: method === 'commit' ? '' : st.commitMsg })
          await loadGit(st, true)
        } catch (e) {
          set({ commitBusy: false, gitErr: { kind: e.kind || 'unknown', message: e.message, hint: e.hint || '' }, toastAt: Date.now() })
        }
      }
      const doCommit = (files) => act('commit', {
        message: st.commitMsg,
        paths: (files || []).map((f) => f.path),
        ticket: g && g.ticket ? g.ticket.commit : null,
      }, (r) => `已提交 ${r.hash}：${r.summary}`)
      const doPush = () => act('sync', { ticket: g ? g.push : null }, (r) => (r.pushed ? '已推送' : '远端已是最新，没有要推的'))

      if (err) {
        return h('div', { style: s.body }, [
          h('div', { key: 'e', style: { border: '1px solid #f85149', borderRadius: 6, padding: '8px 10px', color: '#f85149', fontSize: 12, lineHeight: 1.6 } }, [
            h('div', { key: 'k', style: { fontWeight: 650 } }, '✕ ' + (KIND_ZH[err.kind] || err.kind || '失败')),
            h('div', { key: 'm', style: { color: C.dim, marginTop: 3 } }, err.message),
            err.hint ? h('div', { key: 'h', style: { ...s.faint, fontSize: 10.5, marginTop: 3 } }, '下一步：' + err.hint) : null,
          ]),
          h('button', { key: 'r', style: { ...s.btn(), marginTop: 8 }, onClick: () => loadGit(st, true) }, '重读版本信息'),
        ])
      }
      if (!g) return h('div', { style: { ...s.body, ...s.faint } }, st.gitLoading ? '读版本…' : '还没读版本')

      const files = g.files || []
      return h('div', { style: s.body }, [
        h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' } }, [
          h('span', { key: 'b', style: { fontFamily: C.mono, fontWeight: 600 } }, g.branch || 'HEAD'),
          h('span', { key: 'c', style: { ...s.faint, fontSize: 11, flex: 1, minWidth: 0 } },
            g.clean ? '没有未提交的改动' : `${files.length} 个文件改过`),
          h('button', { key: 'r', style: { ...s.btn(), padding: '2px 8px', fontSize: 11, flex: 'none' }, disabled: !!st.gitLoading, onClick: () => loadGit(st, true) }, st.gitLoading ? '读…' : '刷新改动'),
        ]),

        files.length
          ? h('div', { key: 'fl', style: { border: '1px solid ' + C.line, borderRadius: 6, marginBottom: 10, overflow: 'hidden' } },
            files.slice(0, 40).map((f) => h('div', { key: f.path, style: { display: 'flex', gap: 8, padding: '3px 8px', fontSize: 11.5, borderBottom: '1px solid ' + C.line } }, [
              h('span', { key: 's', style: { ...s.faint, fontFamily: C.mono, width: 14, flex: 'none' } }, GIT_MARK[f.status] || f.status),
              h('span', { key: 'p', style: { fontFamily: C.mono, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.path }, f.path),
              f.staged ? h('span', { key: 'g', style: { ...s.faint, fontSize: 10, flex: 'none' } }, '已暂存') : null,
            ])))
          : null,

        // 提交：有改动才让写。票不用人管——它跟着上面这份改动一起来，改了现场这张票自己就废
        files.length
          ? h('div', { key: 'cm', style: { marginBottom: 10 } }, [
            h('textarea', {
              key: 'msg',
              value: st.commitMsg || '',
              placeholder: '这次提交了什么？一句话说清（会当成 commit message）',
              onChange: (e) => set({ commitMsg: e.target.value }),
              style: { ...s.input, width: '100%', minHeight: 44, resize: 'vertical', boxSizing: 'border-box' },
            }),
            h('div', { key: 'b', style: { display: 'flex', gap: 6, marginTop: 6 } }, [
              h('button', {
                key: 'go',
                style: { ...s.btn(true), padding: '3px 10px', fontSize: 11.5 },
                disabled: !!st.commitBusy || !String(st.commitMsg || '').trim(),
                onClick: () => doCommit(files),
              }, st.commitBusy ? '提交中…' : '提交'),
              h('span', { key: 'w', style: { ...s.faint, fontSize: 10, alignSelf: 'center' } }, '提交范围就是上面这份改动；中途文件又变了会被拒，刷新一下再来'),
            ]),
          ])
          : null,

        // 推送：票绑的是「提交之后的那份现场」，所以提交完要刷新再推
        h('div', { key: 'ps', style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
          h('button', {
            key: 'p',
            style: { ...s.btn(), padding: '3px 10px', fontSize: 11.5 },
            disabled: !!st.commitBusy || !g.push,
            onClick: doPush,
          }, '推送'),
          h('span', { key: 'w', style: { ...s.faint, fontSize: 10 } }, g.push ? '永不 force；远端拒绝会原样报回来' : '没有可推的分支'),
        ]),
      ])
    }

    const Panel = (props) => {
      // 面板是跟着会话走的：切了会话，看板就得换成那个会话所在的项目。
      // 宿主喂会话身份的入口不止一个（tab 的 sessionId、会话 store 的 hook、scope），
      // 只认其中一个就会卡在上一块板上——人是照着右栏看的，那看起来就是「没刷新」。
      const useSessions = props && typeof props.useSessions === 'function' ? props.useSessions : null
      const liveSid = useSessions ? useSessions((x) => (x && x.current) || '') : ''
      const sidNow = String((props && (props.sessionId || (props.scope && props.scope.sessionId))) || liveSid || '')
      // 每个会话一份 store：两个会话并排时，两块板、两份草稿各在各的 store 里
      const store = useStore(sidNow)
      const set = store.set
      const liveCwd = useSessions && sidNow
        ? useSessions((x) => (x && x.byId && x.byId[sidNow] ? x.byId[sidNow].cwd || '' : ''))
        : ''
      const cwdNow = String(liveCwd || (props && props.cwd) || '')
      const cat = store.catalog
      // 目录变了才更新；板按会话各存一份，所以来回切会话不用清空重来
      React.useEffect(() => {
        if (cwdNow && cwdNow !== store.cwd) set({ cwd: cwdNow })
      }, [cwdNow])
      React.useEffect(() => { if (!cat && store.loading) load(store, false) }, [])
      React.useEffect(() => { if (!store.upd) checkUpd(store, false) }, [])
      // 默认就站在看板上，所以不用等谁点一下才去读；会话或目录一变这里跟着重读
      React.useEffect(() => {
        if (store.view === 'board' && (store.sid || store.cwd)) loadBoard(store)
      }, [store.view, store.sid, store.cwd])
      // agent 干活是在会话里写的盘，面板不长眼睛。站在看板上就每 4 秒自己对一次，
      // 它一收尾这里就跟着动——不然人会一直盯着一个不动的「在做」。
      React.useEffect(() => {
        if (store.view !== 'board') return undefined
        const t = setInterval(() => {
          if (store.finish || store.node) return // 正在写结论或看下钻，别把输入冲掉
          loadBoard(store)
        }, 4000)
        // 浏览器里 setInterval 返回数字；node 里（自渲染截图、测试的假 React）返回 Timeout。
        // unref 一下，否则这些假环境会因为一个轮询永远退不出去。
        if (t && typeof t.unref === 'function') t.unref()
        return () => clearInterval(t)
      }, [store.view])
      const toBoard = () => {
        set({ view: 'board' })
        loadBoard(store)
      }
      const toastFresh = store.toast && Date.now() - store.toastAt < 4000

      const head = h('div', { key: 'head', style: s.head }, [
        h('span', { key: 't', style: { fontWeight: 650 } }, 'pstack'),
        cat ? h('span', { key: 'v', style: { ...s.faint, fontFamily: C.mono } }, 'v' + cat.version) : null,
        h('div', { key: 'sp', style: { flex: 1 } }),
        h('button', { key: 'vb', style: { ...s.chip(store.view === 'board'), fontSize: 11 }, onClick: toBoard }, '看板'),
        h('button', {
          key: 'vp',
          style: { ...s.chip(store.view === 'play'), fontSize: 11 },
          onClick: () => { set({ view: 'play' }); loadPlays(store, false) },
        }, '剧本'),
        h('button', { key: 'vs', style: { ...s.chip(store.view === 'skills'), fontSize: 11 }, onClick: () => set({ view: 'skills' }) }, '全部技能'),
        h('button', { key: 've', style: { ...s.chip(store.view === 'env'), fontSize: 11 }, onClick: () => { set({ view: 'env' }); loadEnv(store, false) } }, '环境'),
        h('button', { key: 'vg', style: { ...s.chip(store.view === 'git'), fontSize: 11 }, onClick: () => { set({ view: 'git' }); loadGit(store, false) } }, '版本'),
        store.upd && !store.upd.error
          ? h('span', {
            key: 'pv',
            title: store.upd.hasUpdate
              ? `插件有新版本 ${store.upd.latest}（当前 ${store.upd.current}）`
              : `插件 ${store.upd.current || ''} 是最新的`,
            style: {
              ...s.faint, fontFamily: C.mono, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
              color: store.upd.hasUpdate ? '#f0b132' : undefined,
            },
            onClick: () => checkUpd(true),
          }, store.upd.hasUpdate ? `↑ ${store.upd.latest}` : `${store.upd.current || '?'}`)
          : null,
        cat ? h('button', { key: 'r', style: { ...s.btn(), padding: '2px 6px', fontSize: 11 }, onClick: () => { load(store, true); loadBoard(store) }, title: '重新读一遍磁盘' }, '刷新') : null,
      ])

      if (store.view === 'play') {
        return h('div', { style: s.wrap }, [
          head,
          h(Plays, { key: 'plays', st: store }),
          toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
        ])
      }

      if (store.view === 'board') {
        return h('div', { style: s.wrap }, [
          head,
          h(Board, { key: 'board', st: store }),
          toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
        ])
      }

      if (store.view === 'git') {
        return h('div', { style: s.wrap }, [
          head,
          h(Version, { key: 'git', st: store }),
          toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
        ])
      }
      if (store.view === 'env') {
        return h('div', { style: s.wrap }, [
          head,
          h(Env, { key: 'env', st: store }),
          toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
        ])
      }

      if (store.open) {
        return h('div', { style: s.wrap }, [head, h('div', { key: 'b', style: s.body }, h(Detail, { name: store.open, detail: store.detail, cat: cat || { skills: [] }, st: store }))])
      }

      if (store.error) {
        return h('div', { style: s.wrap }, [head, h('div', { key: 'b', style: s.body }, [
          h('div', { key: 'e', style: { color: '#f0b132', lineHeight: 1.6 } }, '读不到 pstack 目录：' + store.error),
          h('div', { key: 'h', style: { ...s.faint, marginTop: 8, lineHeight: 1.6 } }, '宿主那半可能没起来——多半是插件没加载，或 src/host.js 报错了。看 dsh web 的日志。'),
        ])])
      }

      if (!cat) {
        return h('div', { style: s.wrap }, [head, h('div', { key: 'b', style: { ...s.body, ...s.faint } }, '读目录…')])
      }

      const updBar = store.upd && store.upd.hasUpdate
        ? h('div', { key: 'upd', style: { margin: '8px 10px 0', padding: '6px 8px', border: '1px solid #6b5a20', borderRadius: 6, background: 'rgba(240,177,50,.08)', color: '#f0b132', fontSize: 11.5, lineHeight: 1.6 } }, [
          h('div', { key: 't' }, `插件有新版本 ${store.upd.latest}（当前 ${store.upd.current}）。技能正文不受影响，但面板修的东西要升级才有。`),
          h('div', { key: 'c', style: { fontFamily: C.mono, userSelect: 'all', marginTop: 4, color: '#d8d8d8' } }, 'dsh plugin --profile desktop add dsh-pstack-deck@' + store.upd.latest),
          h('div', { key: 'n', style: { ...s.faint, marginTop: 4 } }, '装完重启宿主：Web 重启 dsh web，桌面版退出重开。'),
        ])
        : null

      const groups = GROUP_ORDER.filter((g) => (cat.groups[g] || []).length)

      return h('div', { style: s.wrap }, [
        head,
        updBar,
        h('div', { key: 'find', style: { padding: '8px 10px 0', flex: 'none' } }, [
          h('input', {
            key: 'q',
            style: s.input,
            placeholder: '搜技能名，或搜「验证」「测试」「文档」',
            value: store.q,
            onChange: (e) => set({ q: e.target.value }),
          }),
          h('div', { key: 'chips', style: { display: 'flex', gap: 4, overflowX: 'auto', padding: '6px 0 2px' } }, [
            h('button', { key: 'all', style: s.chip(store.group === 'all'), onClick: () => set({ group: 'all' }) }, '全部'),
            ...groups.map((g) => h('button', {
              key: g,
              style: s.chip(store.group === g),
              onClick: () => set({ group: store.group === g ? 'all' : g }),
            }, (GROUP_ZH[g] || g) + ' ' + cat.groups[g].length)),
          ]),
        ]),
        h('div', { key: 'body', style: s.body }, [
          cat.driftOk === false ? h('div', { key: 'drift', style: { color: '#f0b132', fontSize: 11.5, lineHeight: 1.6, marginBottom: 8 } },
            '本机 ~/.dsh/skills 和仓库不一致（缺 ' + (cat.drift.missing || []).length + ' 个、改了 ' + (cat.drift.changed || []).length + ' 个）。`/` 菜单读的是副本，跑之前先 npm run sync。') : null,
          h(List, { key: 'list', cat, st: store }),
        ]),
        toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
      ])
    }

    const Title = () => h('span', null, 'pstack')
    const Icon = () => h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, [
      h('path', { key: 'a', d: 'M2 4.5h12M2 8h8M2 11.5h10' }),
      h('circle', { key: 'b', cx: 13, cy: 11.5, r: 2 }),
    ])

    // ------------------------------------------------------------ 装配

    const plugin = {
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots) return
        const once = (name, factory) => {
          try {
            slots.inject(name, () => factory())
          } catch (e) {
            try { factory() } catch (e2) { console.warn('[pstack] slot ' + name + ' 注册失败', e2) }
          }
        }

        // sidebarRightTabs 不在 apply 的 inject 里：它在 apply 跑完才就绪，直接 ctx.get()
        // 拿到 undefined（表现为「面板装好了但没有入口」）。所以要么等它出现再注册，要么重试。
        let tabDisposer = null
        const registerTab = () => {
          if (tabDisposer) return true
          const tabs = ctx.get('sidebarRightTabs')
          if (!tabs || typeof tabs.register !== 'function') return false
          try {
            tabDisposer = tabs.register({
              id: TAB_ID,
              kind: TAB_ID,
              title: () => 'pstack',
              icon: Icon,
              priority: 'builtin',
              guide: [{ order: 70, title: () => 'pstack', icon: Icon }],
            })
            once('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, inject: (sessionId) => ({ sessionId }) }, Panel))
            once('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, Title))
            return true
          } catch (e) {
            console.warn('[pstack] 右栏 tab 注册失败：' + String((e && e.message) || e))
            return false
          }
        }

        if (typeof ctx.inject === 'function') {
          ctx.inject(['sidebarRightTabs'], () => { registerTab() })
        } else {
          let tries = 0
          const timer = setInterval(() => {
            if (registerTab() || ++tries >= 20) clearInterval(timer)
          }, 200)
          ctx.effect(() => () => clearInterval(timer))
        }

        ctx.effect(() => () => {
          try { if (tabDisposer) tabDisposer() } catch { /* 卸载失败无所谓 */ }
          tabDisposer = null
        })

        once('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'dsh-pstack-deck', order: 50 }, Dock))
      },
    }

    exports.inject = ['connection', 'slots']
    exports.apply = function (ctx) {
      __CTX = ctx
      return plugin.apply(ctx)
    }
    return module.exports
  },
})
