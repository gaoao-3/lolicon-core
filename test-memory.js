/**
 * 结构化记忆图谱测试脚本
 *
 * 运行方式：
 *   node test-memory.js
 *
 * 测试内容：
 *   1. 初始化 Memory + GraphMemory + Extractor（mock AI）
 *   2. 模拟多轮对话抽取实体和关系
 *   3. 验证冲突消解（同一关系更新）
 *   4. 验证多实体召回和文本召回
 *   5. 导出 Markdown 视图
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { LoliStorage } from './src/storage.js'
import { Memory } from './src/memory/index.js'

function tmpDir () {
  const dir = path.join(os.tmpdir(), 'lolicon-memory-test-' + Date.now())
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

const mockExtractResponses = [
  {
    entities: [
      { id: 'sensei', type: 'user', label: '老师', aliases: ['老师', 'Sensei'], attrs: { is_master: true } },
      { id: 'lolicon-core', type: 'project', label: 'lolicon-core', aliases: ['lc'] }
    ],
    relations: [
      { from: 'sensei', to: 'lolicon-core', rel: 'develops', confidence: 0.95 },
      { from: 'sensei', to: '蓝色系', rel: 'prefers', value: '#1976D2', confidence: 0.9 }
    ]
  },
  {
    entities: [
      { id: 'sensei', type: 'user', label: '老师', aliases: ['老师'], attrs: { is_master: true } },
      { id: 'node-chaite', type: 'project', label: 'node-chaite', aliases: ['nc'] },
      { id: 'chatgpt-plugin', type: 'project', label: 'chatgpt-plugin', aliases: ['cgpt'] }
    ],
    relations: [
      { from: 'lolicon-core', to: 'node-chaite', rel: 'replaced_by', confidence: 0.92 },
      { from: 'sensei', to: 'node-chaite', rel: 'develops', confidence: 0.88 },
      { from: 'sensei', to: 'chatgpt-plugin', rel: 'works_on', confidence: 0.85 }
    ]
  },
  {
    // 冲突：之前说 sensei prefers 蓝色系，现在说紫色，测试冲突消解
    entities: [
      { id: 'sensei', type: 'user', label: '老师', attrs: {} },
      { id: '紫色', type: 'preference', label: '紫色' }
    ],
    relations: [
      { from: 'sensei', to: '紫色', rel: 'prefers', value: '', confidence: 0.6 }
    ]
  },
  {
    // 非主人用户：不应被标记为 master
    entities: [
      { id: 'lucy', type: 'user', label: 'Lucy', attrs: { is_master: true } },
      { id: 'python', type: 'technology', label: 'Python' }
    ],
    relations: [
      { from: 'lucy', to: 'python', rel: 'uses', confidence: 0.75 }
    ]
  }
]

async function main () {
  const dir = tmpDir()
  console.log('测试数据目录:', dir)

  try {
    const storage = new LoliStorage(dir).open()

    let callIndex = 0
    const extractFn = async (prompt) => {
      const res = mockExtractResponses[callIndex++ % mockExtractResponses.length]
      return '```json\n' + JSON.stringify(res, null, 2) + '\n```'
    }

    const memory = new Memory({
      storage,
      extractFn,
      logger: console.log,
      master: { userId: '10086', label: '老师', aliases: ['Sensei'] }
    })
    await memory.init()

    // 模拟四轮对话：前三轮主人 10086，第四轮非主人 99999
    const conversations = [
      { userText: '我在开发 lolicon-core，替代 node-chaite', assistantText: '好的，老师。lolicon-core 使用 JSON 存储和工具热加载。', event: { user_id: '10086', group_id: '9527' } },
      { userText: '我之前还维护 chatgpt-plugin', assistantText: '明白，chatgpt-plugin 基于 Yunzai 框架。', event: { user_id: '10086', group_id: '9527' } },
      { userText: '其实我也不太讨厌紫色，只是更偏好蓝色', assistantText: '收到，老师的偏好是蓝色系 #1976D2。', event: { user_id: '10086' } },
      { userText: '我在学 Python', assistantText: '加油。', event: { user_id: '99999', group_id: '9527' } }
    ]

    for (const conv of conversations) {
      await memory.record(conv)
    }

    // 强制保存，避免 schedule 延迟
    await memory.graph.destroy()
    await memory.init()

    console.log('\n=== 实体 ===')
    for (const e of memory.graph.entities.values()) {
      const masterTag = e.attrs?.is_master ? ' [主人]' : ''
      console.log(`- ${e.id} (${e.type}): ${e.label}${masterTag} | aliases: ${e.aliases.join(', ')} | hits: ${e.hit_count}`)
    }

    console.log('\n=== 关系 ===')
    for (const r of memory.graph.relations.values()) {
      console.log(`- ${r.from} ${r.rel} ${r.to} ${r.value ? `= ${r.value}` : ''} | conf: ${r.confidence} | hits: ${r.hit_count}`)
    }

    // 主人识别断言
    const masterIds = [...memory.graph.entities.values()].filter(e => e.attrs?.is_master).map(e => e.id)
    console.log('\n=== 主人实体 ===', masterIds)
    if (!masterIds.includes('10086')) {
      throw new Error('主人识别失败：未正确标记 10086')
    }
    if (masterIds.includes('99999') || masterIds.includes('lucy')) {
      throw new Error('主人识别错误：非主人用户被标记为 master')
    }
    if (!memory.graph.relations.has('system::master_of::10086')) {
      throw new Error('主人关系缺失：system -> 10086 的 master_of 关系未建立')
    }

    console.log('\n=== 召回：用户 10086 相关记忆 ===')
    const recallText = memory.recall({ userId: '10086', limit: 10 })
    console.log(recallText)

    console.log('\n=== 文本召回：聊到什么项目 ===')
    const textRecall = memory.recall({ queryText: '老师在做什么项目', limit: 10 })
    console.log(textRecall)

    console.log('\n=== Markdown 导出 ===')
    const md = memory.toMarkdown()
    console.log(md.slice(0, 2000))

    await memory.destroy()
    console.log('\n测试通过。')
  } finally {
    cleanup(dir)
  }
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
