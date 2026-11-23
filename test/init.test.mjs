// 初始化：陌生项目打开面板不能是一块空板。这里钉三件事——
// 上溯到项目根、只写三样东西、重复跑一样都不重写。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { projectName, projectRoot, relFrom } from '../src/anchor.js'
import { AGENTS_MARK, detectInit, initProject } from '../src/init.js'
import { loadBoard } from '../src/board.js'

const tmp = () => mkdtemp(join(tmpdir(), 'pstack-init-'))

test('会话在子目录里也落到项目根：先认 .pstack，再认 .git', async () => {
  const dir = await tmp()
  try {
    await mkdir(join(dir, 'src', 'deep'), { recursive: true })
    assert.equal(projectRoot(join(dir, 'src', 'deep')), join(dir, 'src', 'deep'), '什么都没找到时就是 cwd 本身')
    await mkdir(join(dir, '.git'))
    assert.equal(projectRoot(join(dir, 'src', 'deep')), dir)
    assert.equal(relFrom(dir, join(dir, 'src', 'deep')), 'src/deep')
    assert.equal(relFrom(dir, dir), '')
    assert.equal(projectName(dir), dir.split('/').pop())

    // .pstack 更近就认它：外层是别的仓库时不能让内层写进外层
    await mkdir(join(dir, 'inner', '.pstack'), { recursive: true })
    assert.equal(projectRoot(join(dir, 'inner', 'src')), join(dir, 'inner'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('初始化写三样东西，且地图卡四段能切出来', async () => {
  const dir = await tmp()
  try {
    const before = await detectInit(dir)
    assert.equal(before.initialized, false)
    assert.deepEqual(before.missing, ['board', 'readme', 'agents'])

    const out = await initProject(dir)
    assert.equal(out.initialized, true)
    assert.equal(out.created.length, 3)
    assert.equal(out.mapId, 1)

    const board = await loadBoard(dir)
    assert.equal(board.cards[0].kind, 'map')
    assert.match(board.cards[0].title, /的路线图$/)

    const readme = await readFile(join(dir, '.pstack', 'README.md'), 'utf8')
    assert.match(readme, /一张卡一个 markdown 文件/)
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8')
    assert.match(agents, new RegExp(AGENTS_MARK))
    assert.match(agents, /pstack_board/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('重复初始化不重写：手改过的 AGENTS.md 和只读的板都保住', async () => {
  const dir = await tmp()
  try {
    await writeFile(join(dir, 'AGENTS.md'), '# 我的项目\n\n自己写的规矩\n', 'utf8')
    await initProject(dir, { title: '这条线怎么走' })
    const first = await readFile(join(dir, 'AGENTS.md'), 'utf8')
    assert.match(first, /自己写的规矩/, '原有内容不能被冲掉')
    assert.match(first, /## 项目看板/)

    const again = await initProject(dir)
    assert.deepEqual(again.created, [])
    assert.deepEqual(again.skipped.sort(), ['agents', 'map', 'readme'])
    assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), first)
    assert.equal((await loadBoard(dir)).cards.length, 1, '不能重复建地图卡')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
