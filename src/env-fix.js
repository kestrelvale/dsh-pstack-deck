// 按钮的契约：面板只画它认识的 type，只承诺真能做到的事。
//
// 每种动作都得说清「点了会发生什么」，说不上来的就不该画成按钮——所以未知 type
// 直接拒，而不是让面板摆一个点了没反应的方块。wizard 先登记文案，
// 实现等引导流程解出加密后再补。
// ponytail: wizard 只登记不实现，等加密引导落地再补执行分支。

import { failAs } from './errors.js'

export const ACTIONS = ['refresh', 'rpc', 'inject-prompt', 'open-url', 'wizard']

const DEFAULT_LABEL = {
  refresh: '重新检测',
  rpc: '现在初始化',
  'inject-prompt': '补看板说明',
  'open-url': '打开',
  wizard: '开始引导',
}

/**
 * 校验并复制一个动作；未知 type 抛 unsupported。
 * @param {{ type: string }} a
 */
export function normalizeAction(a) {
  const type = typeof a?.type === 'string' ? a.type.trim() : ''
  if (!ACTIONS.includes(type)) {
    throw failAs('unsupported', `不认识的动作：${String(a?.type ?? '')}`, `只支持 ${ACTIONS.join('、')}`)
  }
  return { ...a, type }
}

/**
 * 按钮文案：自定义 label 优先（同一个动作在不同项上要说不同的话），否则用中文默认。
 * @param {{ type: string, label?: string }} action
 * @param {string} [subjectLabel] 动作作用的对象，写进默认文案里，免得「打开」开向不明
 */
export function labelOf(action, subjectLabel) {
  const custom = typeof action?.label === 'string' ? action.label.trim() : ''
  if (custom) return custom
  if (action?.type === 'open-url' && subjectLabel) return `打开${subjectLabel}`
  return DEFAULT_LABEL[action?.type] ?? String(action?.type ?? '')
}

/**
 * 数据表过滤用：只留能渲染成按钮的项，不校验也不抛错。
 * @param {unknown} a
 */
export function isAction(a) {
  return typeof a?.type === 'string' && ACTIONS.includes(a.type)
}