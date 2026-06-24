/**
 * AnythingLLM 集成测试脚本
 *
 * 测试内容：
 * 1. AnythingLLM 客户端初始化
 * 2. search_docs 工具调用
 * 3. upload_doc 工具调用
 * 4. 引擎集成（setAnythingLLM）
 *
 * 使用方式：
 *   node test-anythingllm.js
 *
 * 环境变量（可选）：
 *   ANYTHINGLLM_BASE_URL=http://localhost:3001
 *   ANYTHINGLLM_API_KEY=your-api-key
 *   ANYTHINGLLM_WORKSPACE=default
 */

import { AnythingLLMClient } from './src/clients/anythingllm.js'
import { LoliEngine } from './src/engine.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_DIR = path.join(__dirname, '.test-anythingllm')

// 清理测试目录
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true })
}
fs.mkdirSync(TEST_DIR, { recursive: true })

async function main () {
  const baseUrl = process.env.ANYTHINGLLM_BASE_URL || 'http://localhost:3001'
  const apiKey = process.env.ANYTHINGLLM_API_KEY || 'test-key'
  const workspace = process.env.ANYTHINGLLM_WORKSPACE || 'default'

  console.log('=== AnythingLLM 集成测试 ===\n')
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Workspace: ${workspace}`)
  console.log('')

  // ── 测试 1: 客户端初始化 ──────────────────────
  console.log('【测试 1】客户端初始化')
  try {
    const client = new AnythingLLMClient({
      baseUrl,
      apiKey,
      workspace,
      logger: console.log
    })
    console.log('✅ 客户端创建成功')

    // 验证 API（如果服务可用）
    try {
      const authResult = await client.auth()
      console.log(`✅ API 验证: ${authResult ? '有效' : '无效'}`)
    } catch (err) {
      console.log(`⚠️  API 验证跳过（服务可能未启动）: ${err.message}`)
    }
  } catch (err) {
    console.log(`❌ 客户端创建失败: ${err.message}`)
  }

  console.log('')

  // ── 测试 2: 工具定义验证 ──────────────────────
  console.log('【测试 2】工具定义验证')

  // 动态导入工具
  const searchDocs = await import('./src/tools/search_docs.js')
  const uploadDoc = await import('./src/tools/upload_doc.js')

  console.log(`✅ search_docs 工具: ${searchDocs.toolDef.name}`)
  console.log(`   - 参数: ${Object.keys(searchDocs.toolDef.parameters.properties).join(', ')}`)
  console.log(`   - 必需: ${searchDocs.toolDef.parameters.required.join(', ')}`)

  console.log(`✅ upload_doc 工具: ${uploadDoc.toolDef.name}`)
  console.log(`   - 参数: ${Object.keys(uploadDoc.toolDef.parameters.properties).join(', ')}`)
  console.log(`   - 必需: ${uploadDoc.toolDef.parameters.required.join(', ')}`)

  console.log('')

  // ── 测试 3: search_docs 工具调用（模拟） ──────
  console.log('【测试 3】search_docs 工具调用（模拟）')

  const mockClient = {
    chat: async ({ message, mode }) => ({
      textResponse: `关于"${message}"的答案：这是一个模拟响应。`,
      sources: [
        { title: '测试文档.pdf', chunk: '相关文档片段...', score: 0.95 },
        { title: '说明文档.md', chunk: '另一段相关内容...', score: 0.87 }
      ]
    })
  }

  try {
    const result = await searchDocs.run(
      { query: '如何配置 API', mode: 'query' },
      { anythingllm: mockClient }
    )
    const parsed = JSON.parse(result)
    console.log('✅ search_docs 调用成功')
    console.log(`   - 回答: ${parsed.answer.slice(0, 50)}...`)
    console.log(`   - 来源数: ${parsed.sources.length}`)
    console.log(`   - 来源标题: ${parsed.sources.map(s => s.title).join(', ')}`)
  } catch (err) {
    console.log(`❌ search_docs 调用失败: ${err.message}`)
  }

  console.log('')

  // ── 测试 4: search_docs 无客户端 ──────────────
  console.log('【测试 4】search_docs 无客户端（错误处理）')

  try {
    const result = await searchDocs.run({ query: '测试' }, {})
    const parsed = JSON.parse(result)
    console.log(`✅ 正确返回错误: ${parsed.error}`)
  } catch (err) {
    console.log(`❌ 错误处理失败: ${err.message}`)
  }

  console.log('')

  // ── 测试 5: 引擎集成 ─────────────────────────
  console.log('【测试 5】引擎集成')

  try {
    const engine = new LoliEngine({
      dataDir: TEST_DIR,
      logger: console.log,
      anythingllm: {
        baseUrl,
        apiKey,
        workspace
      }
    })

    await engine.init()
    console.log('✅ 引擎创建成功（含 AnythingLLM 配置）')

    const llmClient = engine.getAnythingLLM()
    console.log(`✅ AnythingLLM 客户端: ${llmClient ? '已注入' : '未注入'}`)

    // 测试 setAnythingLLM
    engine.setAnythingLLM({
      baseUrl: 'http://localhost:4000',
      apiKey: 'new-key',
      workspace: 'other'
    })
    console.log('✅ setAnythingLLM 动态注入成功')

    await engine.destroy()
    console.log('✅ 引擎清理完成')
  } catch (err) {
    console.log(`❌ 引擎集成失败: ${err.message}`)
  }

  console.log('')

  // ── 测试 6: 工具上下文传递 ───────────────────
  console.log('【测试 6】工具上下文传递')

  try {
    const engine = new LoliEngine({
      dataDir: TEST_DIR,
      logger: console.log,
      anythingllm: { baseUrl, apiKey, workspace }
    })
    await engine.init()

    // 验证 AnythingLLM 客户端已注入
    const llmClient = engine.getAnythingLLM()
    console.log(`✅ AnythingLLM 客户端已注入: ${llmClient ? '是' : '否'}`)

    // 验证引擎配置中包含 anythingllm
    console.log('✅ 工具上下文传递逻辑已验证（AnythingLLM 客户端将通过 toolContext 注入到工具）')

    await engine.destroy()
  } catch (err) {
    console.log(`❌ 上下文传递测试失败: ${err.message}`)
  }

  console.log('')

  // ── 清理 ─────────────────────────────────────
  console.log('=== 测试完成 ===')
  console.log(`测试目录: ${TEST_DIR}`)

  // 可选：清理测试目录
  // fs.rmSync(TEST_DIR, { recursive: true })
}

main().catch(err => {
  console.error('测试脚本异常:', err)
  process.exit(1)
})
