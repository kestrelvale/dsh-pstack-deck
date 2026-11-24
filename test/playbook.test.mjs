// 剧本解析的检查点：22 套里挑几套真的（bug-fix 6 步、refactoring 8 步），
// 钉住「步骤数对得上、点名技能认得出来、不会把整段散文算成步骤」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { listPlaybooks, parsePlaybook, playbookByName, stepOf, titleToSlug } from '../src/playbook.js'
import { buildCatalog } from '../src/catalog.js'

const cat = await buildCatalog()
const known = new Set(cat.skills.map((s) => s.name))

test('剧本名与标题：按文件名取，标题取 ### 行', async () => {
  const all = await listPlaybooks(known)
  assert.ok(all.length >= 20, '仓库里有 22 套')
  const bug = all.find((p) => p.slug === 'bug-fix')
  assert.ok(bug, 'bug-fix 必须解析得到')
  assert.equal(bug.title, 'Bug fix')
  assert.equal(bug.steps.length, 6, 'bug-fix 是 6 步')
  assert.deepEqual(bug.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6])
})

test('步骤里点名的技能：加粗与反引号都认，散文里的技能名也认', async () => {
  const bug = await playbookByName('bug-fix', known)
  assert.ok(bug.steps[1].skills.includes('why'), '第 2 步点名了 why 技能')
  assert.ok(bug.steps[1].skills.includes('interrogate'))
  assert.ok(bug.steps[2].skills.includes('architect'))
  const ref = await playbookByName('refactoring', known)
  assert.equal(ref.steps.length, 8)
  assert.ok(ref.steps[1].skills.includes('principle-model-the-domain'))
  assert.ok(bug.firstSkill, '第一步要点名至少一个技能')
})

test('解析不认识的东西不炸：没编号、没标题、越界步数', () => {
  const p = parsePlaybook('一段没有标题也没有编号的散文\n', new Set(['tdd']))
  assert.equal(p.title, '')
  assert.deepEqual(p.steps, [])
  assert.equal(stepOf(p, 1), null)
  assert.equal(stepOf({ steps: [{ n: 2, text: 'x', skills: ['tdd'] }] }, 2).skills[0], 'tdd')
  assert.equal(stepOf({ steps: [{ n: 2, text: 'x', skills: [] }] }, 9), null)
  assert.equal(titleToSlug('Opening a PR'), 'opening-a-pr')
  assert.equal(titleToSlug('  **TDD**  '), 'tdd')
})

test('越界或坏名字的剧本返回 null，不抛', async () => {
  assert.equal(await playbookByName('../../etc/passwd', known), null)
  assert.equal(await playbookByName('没有这套', known), null)
})
