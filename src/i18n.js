// dsh-pstack-deck · 中文措辞
//
// 这里只有「怎么说」，没有「有什么」：技能清单永远来自 repo/skills。
// 少一条中文不影响可用性，面板会退回英文 description；测试会盯着别漏。

/** 一句话说清一个技能。不是翻译 description，是给人挑东西用。 */
export const ZH = {
  architect: '先画类型、签名、模块，再写代码',
  arena: '同一件事并行做几版，择优拼成一版',
  'automate-me': '把你的干活习惯写成一条 -mode 技能',
  'benchmark-checklist': '报性能数字之前先把它验一遍',
  'blast-radius': '找出这个改动会波及到哪里',
  bro: '把上一条消息翻成人话',
  correct: '把反复犯的错变成不可能再犯',
  'create-formal-verification-skill': '给最要命的代码做形式化验证',
  'create-verification-skill': '造一套像用户那样点一遍的验证',
  'figure-it-out': '大改动先设计一条可审的路线',
  how: '讲清这块代码怎么跑、该放哪一层',
  'in-your-own-words': '复述你的目标，核对有没有理解错',
  interrogate: '多模型围攻，只留能跑出来的问题',
  'ketchup-video': '同上，做成带字幕的短片',
  ketchup: '补上这段时间发生了什么、你该决定什么',
  'maintain-formal-verification-skill': '代码变了，把形式化验证同步过来',
  'maintain-verification-skill': '定期体检验证脚本和功能地图',
  'make-bot-ui': '做一个机器人界面',
  'no-comments': '让 Comment Sicko 清掉废话注释',
  'poteto-help': '不知道用哪个技能，问它',
  'poteto-mode': '打开 poteto 的干活风格',
  'principle-attack-the-premise': '屡修不好，先质疑那个前提',
  'principle-boundary-discipline': '校验只放在系统边界',
  'principle-build-the-lever': '造工具，别用手搬',
  'principle-encode-lessons-in-structure': '同一句话写第二遍，就该变成检查',
  'principle-exhaust-the-design-space': '没先例就先做两三个原型比',
  'principle-experience-first': '用户爽 > 实现省事',
  'principle-explain-the-number': '报数字前先说清它受什么限制',
  'principle-fix-root-causes': '修第一现场，不修症状',
  'principle-foundational-thinking': '先把数据结构定对',
  'principle-guard-the-context-window': '上下文见底就把粗活分出去',
  'principle-laziness-protocol': '能删就删，改得越少越好',
  'principle-make-operations-idempotent': '重跑一次，结果还得一样',
  'principle-migrate-callers-then-delete-legacy-apis': '调用方迁完就删旧接口',
  'principle-minimize-reader-load': '少一层包装，少一个要记的状态',
  'principle-model-the-domain': '把业务状态建成模型',
  'principle-never-block-on-the-human': '可逆的事别停下来问',
  'principle-outcome-oriented-execution': '直奔终态，不留过渡层',
  'principle-prove-it-works': '说做完之前真跑一遍',
  'principle-redesign-from-first-principles': '新需求进旧设计，重新想一遍',
  'principle-separate-before-serializing-shared-state': '先消共享，再谈加锁',
  'principle-sequence-verifiable-units': '拆成逐个可验证的小步',
  'principle-subtract-before-you-add': '先删死代码，再动手加',
  'principle-test-behavior-not-implementation': '测行为，不测实现',
  'principle-type-system-discipline': '让非法状态写不出来',
  recall: '从聊天记录里重建我在干什么',
  reflect: '从这段对话里提炼该改哪条技能',
  'setup-pstack': '配 pstack 用哪些模型、给多少思考',
  sharpen: '把任务做深，不是做大',
  'show-me-your-work': '每个决定留一行可查记录',
  statechart: '把状态机画出来、验一遍',
  swarm: '并行铺开一批活，收成一份报告',
  tdd: '先写一个会失败的测试',
  teach: '讲明白一件事，让人真懂',
  'technical-writing': '按技术写作规范改文档',
  'typescript-best-practices': 'TS 写法规范',
  unslop: '去掉 AI 腔',
  why: '讲清当初为什么这么定',
}

/** 原则分组怎么说。分组名来自 README 表，不来自这里。 */
export const GROUP_ZH = {
  core: '核心准则',
  architecture: '架构',
  verification: '验证',
  delegation: '分工',
  meta: '元准则',
  workflow: '工作流',
}

/**
 * 上手引导：从「刚装好」到「会自己挑」的五步。每步只给一个按钮，注入一句提示词。
 * inject 里的 /name 靠面板把它塞进输入框，用户按回车就发出去了。
 */
export const GUIDE = [
  {
    id: 'start',
    title: '先开风格',
    when: '第一次用 pstack，想让 agent 按这套准则干活',
    inject: '/poteto-mode',
  },
  {
    id: 'read',
    title: '先看再改',
    when: '要动一块不熟的代码',
    inject: '/how 这块代码是怎么跑起来的？我应该把改动放在哪一层？',
  },
  {
    id: 'fix',
    title: '修对地方',
    when: '有 bug，但不确定根因在哪',
    inject: '/principle-fix-root-causes 这个 bug 的第一现场在哪？',
  },
  {
    id: 'prove',
    title: '证明能用',
    when: '改完了，准备说「做完了」',
    inject: '/principle-prove-it-works 帮我真跑一遍，拿真实结果说话',
  },
  {
    id: 'own',
    title: '变成你的',
    when: '用的顺手了，想让它记住你的习惯',
    inject: '/automate-me',
  },
]

export function zhOf(skill) {
  return ZH[skill.name] ?? skill.description ?? ''
}
