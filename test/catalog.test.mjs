// dsh-pstack-deck · 目录层自检。跑：node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseFrontmatter, parseSkill, parseReadme, buildCatalog, diffInstalled, repoRoot } from '../src/catalog.js'

test('frontmatter：pstack 的六种标量字段', () => {
  const { data, body } = parseFrontmatter('---\nname: teach\ndescription: "教点什么"\ndisable-model-invocation: true\nargument-hint: 你想学什么？\n---\n\n正文')
  assert.equal(data.name, 'teach')
  assert.equal(data.description, '教点什么')
  assert.equal(data['disable-model-invocation'], 'true')
  assert.equal(data['argument-hint'], '你想学什么？')
  assert.equal(body.trim(), '正文')
})

test('frontmatter：没有 --- 就原样返回，不炸', () => {
  const r = parseFrontmatter('没有 frontmatter 的文件')
  assert.deepEqual(r.data, {})
  assert.equal(r.body, '没有 frontmatter 的文件')
})

test('parseSkill：name 与目录名不一致就丢掉（宿主侧对不上）', () => {
  const text = '---\nname: teach\ndescription: x\n---\n'
  assert.equal(parseSkill(text, 'teach').name, 'teach')
  assert.equal(parseSkill(text, 'tdd'), null)
  assert.equal(parseSkill('---\ndescription: x\n---\n', 'tdd'), null)
})

test('parseSkill：disable-model-invocation 翻成 modelInvocable', () => {
  const off = parseSkill('---\nname: a\ndisable-model-invocation: true\n---\n', 'a')
  const on = parseSkill('---\nname: b\n---\n', 'b')
  assert.equal(off.modelInvocable, false)
  assert.equal(on.modelInvocable, true)
})

test('parseReadme：三张表都认', () => {
  const md = [
    'so each one works alone:',
    '',
    '`unslop`, `bro`, `tdd`',
    '',
    '| Skill | Also install |',
    '|---|---|',
    '| `teach` | `how`, `why` |',
    '| `ketchup` | `bro` |',
    '',
    '| principle | group | rule |',
    '|---|---|---|',
    '| [laziness-protocol](./skills/principle-laziness-protocol/SKILL.md) | core | Bias toward deletion. |',
    '| [investigation](./skills/poteto-mode/playbooks/investigation.md) | 不是技能行的表，不能当技能 |',
    '',
    '| skill | use it when |',
    '|---|---|',
    '| [`/tdd`](./skills/tdd/SKILL.md) | 先写失败测试。 |',
  ].join('\n')
  const p = parseReadme(md)
  assert.deepEqual(p.deps, { teach: ['how', 'why'], ketchup: ['bro'] })
  // 名字取路径：链接文字是短名 laziness-protocol，真名带 principle- 前缀
  assert.equal(p.principles['principle-laziness-protocol'].group, 'core')
  assert.equal(p.principles['principle-laziness-protocol'].rule, 'Bias toward deletion.')
  assert.equal(p.principles['laziness-protocol'], undefined)
  // playbooks 行不是技能
  assert.equal(Object.keys(p.principles).length, 1)
  assert.equal(p.useWhen['tdd'], '先写失败测试。')
  assert.deepEqual(p.standalone, ['unslop', 'bro', 'tdd'])
})

test('buildCatalog：真实仓库的 58 个技能、24 条原则分五组、依赖表生效', async () => {
  const cat = await buildCatalog({ root: repoRoot() })
  assert.equal(cat.skills.length, 58)
  assert.equal(Object.keys(cat.groups.core ?? {}).length >= 10, true)
  assert.deepEqual(cat.deps.teach.sort(), ['how', 'why'])
  assert.deepEqual(cat.deps['ketchup-video'].sort(), ['bro', 'ketchup'])
  assert.equal(cat.deps['poteto-help'], undefined)
  assert.equal(cat.deps['poteto-mode'].length, 42) // 24 条原则 + 18 个能独立跑的
  assert.equal(cat.missingDeps.teach, undefined)
  assert.equal(cat.skills.filter((s) => s.modelInvocable === false).length, 57)
  assert.match(cat.version, /^\d+\.\d+\.\d+$/)
})

test('diffInstalled：副本缺目录 → missing；改一个字 → changed', async () => {
  const src = await mkdtemp(join(tmpdir(), 'psp-src-'))
  const dst = await mkdtemp(join(tmpdir(), 'psp-dst-'))
  try {
    for (const name of ['a', 'b']) {
      await mkdir(join(src, 'skills', name), { recursive: true })
      await writeFile(join(src, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n正文\n`)
    }
    await mkdir(join(dst, 'a'), { recursive: true })
    await writeFile(join(dst, 'a', 'SKILL.md'), '---\nname: a\n---\n正文\n')

    const r1 = await diffInstalled({ root: src, installedRoot: dst, names: ['a', 'b'] })
    assert.deepEqual(r1.missing, ['b'])
    assert.deepEqual(r1.changed, [])
    assert.equal(r1.ok, false)

    await writeFile(join(dst, 'a', 'SKILL.md'), '---\nname: a\n---\n正文改了一个字\n')
    const r2 = await diffInstalled({ root: src, installedRoot: dst, names: ['a'] })
    assert.deepEqual(r2.changed, ['a'])
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(dst, { recursive: true, force: true })
  }
})

test('i18n：58 个技能都有中文一句话，没有多余条目', async () => {
  const { ZH, GROUP_ZH, GUIDE } = await import('../src/i18n.js')
  const cat = await buildCatalog({ root: repoRoot() })
  const names = cat.skills.map((s) => s.name)
  assert.deepEqual(names.filter((n) => !ZH[n]), [], '缺中文的技能')
  assert.deepEqual(Object.keys(ZH).filter((n) => !names.includes(n)), [], '中文里有不存在的技能')
  for (const g of Object.keys(cat.groups)) assert.ok(GROUP_ZH[g], `分组 ${g} 没有中文名`)
  for (const step of GUIDE) assert.match(step.inject, /^\/[a-z0-9-]+/, `引导 ${step.id} 要注入 /技能名`)
})
