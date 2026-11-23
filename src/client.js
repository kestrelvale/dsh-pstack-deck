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
      throw new Error((res && res.error && (res.error.message || res.error.code)) || '宿主没有响应')
    }

    const store = {
      catalog: null,
      error: '',
      loading: true,
      q: '',
      group: 'all',
      open: null, // 技能名：详情页
      detail: null,
      draft: '', // 详情页里「注入」后的原文，注入失败时给用户手抄
      zhOnly: false, // 有中文正文时默认显示中文，点一下切回原文
      finish: null, // { id, state }：正在收尾哪张卡，收尾必须写一句结论
      finNote: '',
      sugOpen: '', // 展开了哪条建议（看 Jev 分数和命令）
      node: null, // 流程图里下钻的卡号
      view: 'board', // board | skills —— 默认看板：进来先看到「这个项目要干什么」，而不是 58 个技能名
      sid: '', // 会话号：看板要用它换出这个会话的项目目录
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
    }
    const subs = new Set()
    const emit = () => subs.forEach((fn) => fn(store))
    const set = (patch) => {
      Object.assign(store, patch)
      emit()
    }
    const useStore = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const fn = () => force((n) => n + 1)
        subs.add(fn)
        return () => subs.delete(fn)
      }, [])
      return store
    }

    const load = async (fresh) => {
      set({ loading: !store.catalog, error: '' })
      try {
        const cat = await rpc('catalog', fresh ? { fresh: true } : {})
        set({ catalog: cat, loading: false })
      } catch (e) {
        set({ loading: false, error: String((e && e.message) || e) })
      }
    }

    // 问一次 npm 上有没有新版本。宿主那半缓存十分钟，所以开面板顺手查一下不心疼。
    const checkUpd = async (fresh) => {
      if (store.updBusy) return
      set({ updBusy: true })
      try {
        const r = await rpc('update', fresh ? { fresh: true } : {})
        set({ upd: r, updBusy: false })
      } catch (e) {
        set({ upd: { error: String((e && e.message) || e) }, updBusy: false })
      }
    }

    const openSkill = async (name) => {
      set({ open: name, detail: null, draft: '' })
      try {
        const d = await rpc('skill', { name })
        if (store.open === name) set({ detail: d })
      } catch (e) {
        if (store.open === name) set({ detail: { ok: false, message: String((e && e.message) || e) } })
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

    const inject = (line) => {
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
      const missing = cat.missingDeps && cat.missingDeps[skill.name]
      const deps = skill.deps || []
      return h('div', {
        style: s.card(false),
        onClick: () => openSkill(skill.name),
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
      const skill = (cat.skills || []).find((x) => x.name === name) || { name }
      return h('div', null, [
        h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('button', { key: 'b', style: s.btn(), onClick: () => set({ open: null, detail: null }) }, '‹ 全部'),
          h('span', { key: 'n', style: { ...s.name, fontSize: 13 } }, '/' + name),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', { key: 'i', style: s.btn('primary'), onClick: () => inject('/' + name + (skill.argumentHint ? ' ' : '')) }, '放进输入框'),
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

    const Guide = () => h('div', { style: { marginBottom: 10 } }, [
      h('div', { key: 't', style: { ...s.faint, margin: '2px 0 6px' } }, '不知道点哪个？按这个顺序走'),
      ...GUIDE.map((step, i) => h('div', {
        key: step.id,
        style: { ...s.card(false), cursor: 'default' },
      }, [
        h('div', { key: 'a', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('span', { key: 'i', style: { ...s.faint, fontFamily: C.mono } }, String(i + 1)),
          h('span', { key: 't', style: { fontWeight: 600 } }, step.title),
          h('div', { key: 's', style: { flex: 1 } }),
          h('button', { key: 'b', style: s.btn('primary'), onClick: () => inject(step.inject) }, '用这个'),
        ]),
        h('div', { key: 'w', style: { color: C.dim, marginTop: 3, fontSize: 12 } }, step.when),
      ])),
    ])

    const List = (props) => {
      const { cat } = props
      const q = store.q.trim().toLowerCase()
      const rows = (cat.skills || []).filter((sk) => {
        if (store.group !== 'all' && (sk.principle ? sk.principle.group : 'workflow') !== store.group) return false
        if (!q) return true
        return sk.name.includes(q) || String(sk.zh || '').toLowerCase().includes(q) || String(sk.description || '').toLowerCase().includes(q)
      })
      const showGuide = !q && store.group === 'all'
      return h('div', null, [
        showGuide ? h(Guide, { key: 'g' }) : null,
        ...GROUP_ORDER.filter((g) => (cat.groups[g] || []).length).map((g) => {
          const hit = rows.filter((sk) => (sk.principle ? sk.principle.group : 'workflow') === g)
          if (!hit.length) return null
          return h('div', { key: g }, [
            h('div', { key: 'h', style: { ...s.faint, margin: '12px 0 6px', letterSpacing: '.06em' } }, `${GROUP_ZH[g] || g} · ${hit.length}`),
            ...hit.map((sk) => h(SkillRow, { key: sk.name, skill: sk, cat })),
          ])
        }),
        rows.length ? null : h('div', { key: 'none', style: { ...s.faint, padding: '16px 4px' } }, '没有匹配的技能。'),
      ])
    }

    // ------------------------------------------------------------ 看板

    const KIND_LABEL = { idea: '想法', bug: '缺陷', task: '任务' }
    const STATE_LABEL = { idea: '想法', todo: '待办', doing: '在做', done: '完成', dropped: '已废弃' }
    const STATE_ORDER = ['doing', 'todo', 'idea', 'done', 'dropped']
    // 地图卡正文的四段，和 board.js 的 MAP_SECTIONS 是同一套标题
    const MAP_SECTIONS = [
      { key: 'destination', label: '去向' },
      { key: 'decisions', label: '已经定了' },
      { key: 'fog', label: '还没想清' },
      { key: 'out', label: '不做什么' },
    ]

    const loadBoard = async () => {
      try {
        set({ board: await rpc('board', { sessionId: store.sid }) })
      } catch (e) {
        set({ toast: '读不到看板：' + String((e && e.message) || e), toastAt: Date.now() })
      }
      try {
        set({ sug: await rpc('suggest', { sessionId: store.sid }) })
      } catch (e) {
        set({ sug: null })
      }
    }

    const LAYER_ZH = { project: '按这个项目推', global: '项目里还没卡，看看别的项目', seed: '先起个头' }

    // 三层决策的结果：3~5 条，每条都带着写好的提示词，点一下就能发
    const Suggest = () => {
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
              const view = await rpc(method, { sessionId: store.sid, ...payload })
              const patch = { board: view, toast: ok, toastAt: Date.now() }
              try {
                patch.sug = await rpc('suggest', { sessionId: store.sid })
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
                          await rpc('boardAct', { sessionId: store.sid, id: it.cardId, action: 'claim', owner: store.sid || 'me' })
                        } catch {
                          /* 被挡着或已有人认领，注入照做 */
                        }
                      }
                      inject(it.prompt)
                      loadBoard()
                    },
                  }, '执行这条命令'),
                  it.cardId ? h('button', {
                    key: 'd',
                    style: s.btn(),
                    onClick: () => set({ finish: { id: it.cardId, state: 'done' }, finNote: '', sugOpen: '' }),
                  }, '标为完成') : null,
                ]),
                it.cardId ? FinishEditor({ id: it.cardId, call: doIt }) : null,
              ])
              : null,
          ])
        }),
      ])
    }

    // 收尾编辑器：完成和废弃都要一句结论才落盘。
    // 这不是形式主义——没有结论的「已完成」，三天后没人知道当时到底做了什么、验没验。
    const FinishEditor = ({ id, call }) => {
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

    const Board = () => {
      const b = store.board
      // 一次动作 = 一次整体刷新：卡片状态和「建议接下来做这几件」必须同一帧更新，
      // 否则卡片落进「完成」但推荐还停在上一条，人就会以为没生效。
      const call = async (method, payload, okText) => {
        try {
          const view = await rpc(method, { sessionId: store.sid, ...payload })
          const patch = { board: view, toast: okText, toastAt: Date.now() }
          try {
            patch.sug = await rpc('suggest', { sessionId: store.sid })
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

      const cards = (b.cards || []).filter((c) => c.kind !== 'map')
      const frontier = new Set(b.frontier || [])
      const open = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped')
      const conflicts = b.conflicts || { pairs: [], unscoped: [] }
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
              h('button', { key: 'u', style: { ...s.btn(), padding: '2px 8px', fontSize: 11, flex: 'none' }, onClick: () => inject('/' + name + ' ') }, '用这个'),
            ])
          }),
        ])
        : null

      return h('div', { style: s.body }, [
        h('div', { key: 'proj', style: { ...s.faint, fontSize: 10, marginBottom: 8, wordBreak: 'break-all' } },
          `📁 ${proj ? proj.name : ''} · ${b.root || b.cwd}${proj && proj.rel ? `（当前是它的子目录：${proj.rel}）` : ''}`),
        initCard,
        h(Suggest, { key: 'sug' }),
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

        // 并行冲突：同一块路径被两张在做的卡同时改
        conflicts.pairs.length
          ? h('div', { key: 'cf', style: { border: '1px solid #f0b132', borderRadius: 6, padding: '6px 8px', marginBottom: 10, color: '#f0b132', fontSize: 12, lineHeight: 1.55 } },
            '⚠ 并行冲突：' + conflicts.pairs.map((p) => `#${p.a} 与 #${p.b} 都要动 ${p.paths.join('、')}`).join('；') + '。先串行，别同时改。')
          : null,

        store.flow ? h(Flow, { key: 'flow' }) : null,
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
              return sug ? h('div', { key: 'sug', style: { ...s.faint, fontSize: 10, marginTop: 4 } },
                `建议 /${sug.skill} · 紧急 ${sug.urgency != null ? sug.urgency.toFixed(2) : '?'} · 把握 ${sug.certainty != null ? sug.certainty.toFixed(2) : '?'}${sug.ask ? ' · 先确认' : ''}`) : null
            })(),
            h('div', { key: 'n', style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, [
              c.next ? h('button', { key: 'u', style: { ...s.btn('primary'), padding: '2px 8px', fontSize: 11 }, onClick: () => inject('/' + c.next.skill + ' ' + c.title) }, '/' + c.next.skill) : null,
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
            FinishEditor({ id: c.id, call }),
          ])),
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
    const NodeDetail = ({ id }) => {
      const card = ((store.board && store.board.cards) || []).find((c) => c.id === Number(id))
      if (!card) return null
      const it = ((store.sug && store.sug.items) || []).find((x) => x.cardId === card.id)
      const skill = (it && it.skill) || (card.next && card.next.skill)
      const why = (it && it.why) || (card.next && card.next.why) || ''
      const prompt = it ? it.prompt : skill ? '/' + skill + ' #' + card.id + ' ' + card.title : ''
      const go = async (method, payload, ok) => {
        try {
          set({ board: await rpc(method, { sessionId: store.sid, ...payload }), toast: ok, toastAt: Date.now() })
          set({ node: null })
          loadBoard()
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
          card.blocked && card.blocked.length ? ' · 等 #' + card.blocked.join(' #') : '',
        ].join('')),
        why ? h('div', { key: 'w', style: { color: C.dim, fontSize: 12, margin: '4px 0' } }, (skill ? `下一步 /${skill}：` : '') + why) : null,
        it && it.urgency != null
          ? h('div', { key: 'j', style: { ...s.faint, fontSize: 10, marginBottom: 6 } },
            `Jev：紧急 ${it.urgency.toFixed(2)} · 把握 ${it.certainty.toFixed(2)}${it.ask ? ' · 先确认' : ''}`)
          : null,
        prompt
          ? h('div', { key: 'c', style: { fontFamily: C.mono, fontSize: 11, background: 'rgba(0,0,0,.3)', border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', marginBottom: 8, userSelect: 'all', wordBreak: 'break-all' } }, prompt)
          : null,
        h('div', { key: 'a', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          prompt ? h('button', { key: 'u', style: s.btn('primary'), onClick: () => inject(prompt) }, '执行这条命令') : null,
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
        FinishEditor({ id: card.id, call: go }),
      ])
    }

    // 拓扑：一列一层，连线指向前置 → 后继；废弃的画虚线、单列到底
    const Flow = () => {
      const g = store.board && store.board.graph
      if (!g || !g.nodes.length) return h('div', { style: { ...s.faint, padding: '4px 0' } }, '还没有卡')
      const cards = (store.board && store.board.cards) || []
      const COL = 118
      const ROW = 86 // 节点下面还要画两格「推荐 / 完成」的预期，行高留够
      const W = 100
      const H = 40
      const colIdx = new Map()
      const pos = new Map()
      for (const n of g.nodes) {
        const i = colIdx.get(n.depth) ?? 0
        colIdx.set(n.depth, i + 1)
        pos.set(n.id, { x: 8 + n.depth * COL, y: 8 + i * ROW })
      }
      const width = 16 + (g.depthMax + 1) * COL
      const height = 16 + Math.max(...[...colIdx.values()], 1) * ROW
      const nodes = g.nodes.map((n) => {
        const p = pos.get(n.id)
        const color = STATE_COLOR[n.state] || '#6b7280'
        const label = String(n.title).length > 7 ? String(n.title).slice(0, 6) + '…' : String(n.title)
        return h('g', { key: n.id, onClick: () => set({ node: store.node === n.id ? null : n.id }), style: { cursor: 'pointer' } }, [
          h('title', { key: 'ti' }, '#' + n.id + ' ' + n.title),
          h('rect', {
            key: 'r',
            x: p.x, y: p.y, width: W, height: H, rx: 6,
            fill: 'rgba(0,0,0,.25)', stroke: color, strokeWidth: n.state === 'doing' ? 2 : 1,
            strokeDasharray: n.state === 'dropped' ? '4 3' : undefined,
            opacity: n.state === 'dropped' || n.state === 'done' ? 0.55 : 1,
          }),
          h('text', { key: 'i', x: p.x + 6, y: p.y + 14, fill: color, fontSize: 9, fontFamily: C.mono }, '#' + n.id),
          h('text', { key: 't', x: p.x + 6, y: p.y + 30, fill: C.fg, fontSize: 10.5 }, label),
        ])
      })
      // 预期线路：现状之后要发生什么，画成虚线格（推荐技能 + 完成）
      const sugByCard = new Map(((store.sug && store.sug.items) || []).map((it) => [it.cardId, it]))
      const ghosts = []
      for (const n of g.nodes) {
        if (n.state === 'done' || n.state === 'dropped') continue
        const p = pos.get(n.id)
        const it = sugByCard.get(n.id)
        const card = cards.find((c) => c.id === n.id) || {}
        const skill = (it && it.skill) || (card.next && card.next.skill)
        if (!skill) {
          // 被挡着的卡也有预期：等前面几张做完
          if ((card.blocked || []).length) {
            ghosts.push(h('g', { key: 'gw' + n.id, style: { cursor: 'default' } }, [
              h('rect', {
                key: 'r', x: p.x, y: p.y + H + 4, width: W, height: 15, rx: 4,
                fill: 'rgba(255,255,255,.03)', stroke: '#3a3f4b', strokeWidth: 1, strokeDasharray: '2 3',
              }),
              h('text', { key: 't', x: p.x + 5, y: p.y + H + 15, fill: '#6b7280', fontSize: 9, fontFamily: C.mono }, '⏳ 等 #' + card.blocked.join(' #')),
            ]))
          }
          continue
        }
        const box = (i, label, tip, onClick) => h('g', { key: 'g' + n.id + i, onClick, style: { cursor: 'pointer' } }, [
          h('title', { key: 'ti' }, tip),
          h('rect', {
            key: 'r',
            x: p.x, y: p.y + H + 4 + i * 18, width: W, height: 15, rx: 4,
            fill: 'rgba(122,162,247,.07)', stroke: '#4b5b75', strokeWidth: 1, strokeDasharray: '3 3',
          }),
          h('text', { key: 't', x: p.x + 5, y: p.y + H + 15 + i * 18, fill: '#8aa0c8', fontSize: 9.5, fontFamily: C.mono }, label),
        ])
        ghosts.push(box(0, '→ /' + skill, '推荐下一步：' + (it ? it.prompt : '/' + skill), () => (it ? inject(it.prompt) : inject('/' + skill + ' #' + n.id + ' ' + n.title))))
        ghosts.push(box(1, '✓ 完成 #' + n.id, '把它标为完成', () => set({ node: n.id })))
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
        const target = store.board.cards.find((c) => c.id === e.to)
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
      const legend = ['doing', 'todo', 'idea', 'done', 'dropped'].map((st) => h('span', {
        key: st,
        style: { color: STATE_COLOR[st], fontSize: 10, marginRight: 8 },
      }, '■ ' + (STATE_LABEL[st] || st)))
      return h('div', {}, [
        h('div', { key: 'lg', style: { ...s.faint, margin: '2px 0 6px' } }, legend),
        h('div', { key: 'svg', style: { overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 } },
          h('svg', { width, height, viewBox: `0 0 ${width} ${height}` }, [...edges, ...nodes, ...ghosts])),
        h('div', { key: 'h', style: { ...s.faint, fontSize: 10, marginTop: 4 } }, '点一格看这张卡下一步怎么走；虚线小格是预期线路：推荐的技能，和完成。'),
        store.node ? h(NodeDetail, { key: 'nd', id: store.node }) : null,
      ])
    }

    const Panel = (props) => {
      useStore()
      const cat = store.catalog
      React.useEffect(() => { if (!cat && store.loading) load(false) }, [])
      React.useEffect(() => { if (!store.upd) checkUpd(false) }, [])
      React.useEffect(() => {
        if (props && props.sessionId && props.sessionId !== store.sid) set({ sid: props.sessionId })
      }, [props && props.sessionId])
      // 默认就站在看板上，所以不用等谁点一下才去读
      React.useEffect(() => {
        if (store.view === 'board' && !store.board) loadBoard()
      }, [store.view, store.sid])
      // agent 干活是在会话里写的盘，面板不长眼睛。站在看板上就每 4 秒自己对一次，
      // 它一收尾这里就跟着动——不然人会一直盯着一个不动的「在做」。
      React.useEffect(() => {
        if (store.view !== 'board') return undefined
        const t = setInterval(() => {
          if (store.finish || store.node) return // 正在写结论或看下钻，别把输入冲掉
          loadBoard()
        }, 4000)
        // 浏览器里 setInterval 返回数字；node 里（自渲染截图、测试的假 React）返回 Timeout。
        // unref 一下，否则这些假环境会因为一个轮询永远退不出去。
        if (t && typeof t.unref === 'function') t.unref()
        return () => clearInterval(t)
      }, [store.view])
      const toBoard = () => {
        set({ view: 'board' })
        if (!store.board) loadBoard()
      }
      const toastFresh = store.toast && Date.now() - store.toastAt < 4000

      const head = h('div', { key: 'head', style: s.head }, [
        h('span', { key: 't', style: { fontWeight: 650 } }, 'pstack'),
        cat ? h('span', { key: 'v', style: { ...s.faint, fontFamily: C.mono } }, 'v' + cat.version) : null,
        h('div', { key: 'sp', style: { flex: 1 } }),
        h('button', { key: 'vb', style: { ...s.chip(store.view === 'board'), fontSize: 11 }, onClick: toBoard }, '看板'),
        h('button', { key: 'vs', style: { ...s.chip(store.view === 'skills'), fontSize: 11 }, onClick: () => set({ view: 'skills' }) }, '全部技能'),
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
        cat ? h('button', { key: 'r', style: { ...s.btn(), padding: '2px 6px', fontSize: 11 }, onClick: () => { load(true); if (store.board) loadBoard() }, title: '重新读一遍磁盘' }, '刷新') : null,
      ])

      if (store.view === 'board') {
        return h('div', { style: s.wrap }, [
          head,
          h(Board, { key: 'board' }),
          toastFresh ? h('div', { key: 'toast', style: { flex: 'none', margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(122,162,247,.14)', color: C.accent, fontSize: 11.5 } }, store.toast) : null,
        ])
      }

      if (store.open) {
        return h('div', { style: s.wrap }, [head, h('div', { key: 'b', style: s.body }, h(Detail, { name: store.open, detail: store.detail, cat: cat || { skills: [] } }))])
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
          h(List, { key: 'list', cat }),
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
