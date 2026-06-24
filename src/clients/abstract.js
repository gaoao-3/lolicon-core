/**
 * AbstractClient — 消息管道 + 工具调用循环
 * 从 node-chaite clients.ts 精简而来
 *
 * 核心流程:
 *   user msg → _sendMessage() → AI response
 *     ├─ 有 toolCalls → 执行工具（注入事件上下文）→ 结果回传 → 循环
 *     └─ 无 → 返回最终文本
 */
import { randomUUID } from 'crypto'

/** @typedef {import('../types.js').UnifiedMessage} UnifiedMessage */

export class AbstractClient {
  /** @type {LoliStorage} */
  storage
  /** @type {Object[]} 已加载的工具实例 */
  tools = []
  /** @type {Object} */
  options
  /** @type {Function} */
  logger

  /** 子类须覆盖 */
  get adapterType () { return 'abstract' }

  /**
   * @param {Object} opts
   * @param {LoliStorage} opts.storage
   * @param {Object} opts.options - channel options (apiKey, baseUrl, etc.)
   * @param {Function} [opts.logger]
   */
  constructor (opts) {
    this.storage = opts.storage
    this.options = opts.options || {}
    this.logger = opts.logger || (() => {})
  }

  /**
   * 子类实现 — 调用 AI API
   * @param {UnifiedMessage[]} histories
   * @param {Object} options
   * @returns {Promise<UnifiedMessage>}
   */
  async _sendMessage (histories, options) {
    throw new Error('_sendMessage must be implemented by subclass')
  }

  // ── 工具调用循环 ──────────────────────────────

  /** 最大工具调用轮次 */
  #MAX_ROUNDS = 8
  /** 同一工具最大连续调用次数 */
  #MAX_SAME_CALL = 2

  /**
   * 发送消息（含工具调用循环 + 历史管理）
   *
   * @param {Object} params
   * @param {UnifiedMessage} params.userMessage
   * @param {string} params.conversationId
   * @param {Object} params.options - sendMessageOption
   * @param {UnifiedMessage} [params.systemPrompt]
   * @param {Object[]} [params.tools] - 此轮可用的工具实例
   * @param {Object} [params.event] - Yunzai 事件，注入工具上下文
   * @param {Object} [params.toolContext] - 额外工具上下文（如 anythingllm 客户端）
   * @returns {Promise<{response: UnifiedMessage, finalText: string}>}
   */
  async sendMessage ({ userMessage, conversationId, options = {}, systemPrompt, tools = [], event, toolContext }) {
    this.tools = tools
    const toolDefs = this.#buildToolDefs(tools)

    // 1. 加载历史
    let histories = await this.storage.getHistory(conversationId, 50)

    // 2. 注入系统提示
    if (systemPrompt) {
      const lastSys = histories.filter(h => h.role === 'system')
      if (lastSys.length === 0) {
        histories = [systemPrompt, ...histories]
      }
    }

    // 3. 保存用户消息
    userMessage.id = userMessage.id || randomUUID()
    userMessage.conversationId = conversationId
    await this.storage.saveHistory(userMessage)
    histories.push(userMessage)

    // 4. 首轮调用
    const callCount = {}
    let currentResponse = await this._sendMessage(histories, { ...options, tools: toolDefs })

    // 5. 保存模型响应
    currentResponse.id = currentResponse.id || randomUUID()
    currentResponse.conversationId = conversationId
    await this.storage.saveHistory(currentResponse)

    // 6. 工具调用循环
    let round = 0
    while (this._hasToolCalls(currentResponse) && round < this.#MAX_ROUNDS) {
      round++

      const toolCalls = this._getToolCalls(currentResponse)
      const toolResults = []

      for (const tc of toolCalls) {
        const key = tc.name
        callCount[key] = (callCount[key] || 0) + 1

        if (callCount[key] > this.#MAX_SAME_CALL) {
          toolResults.push({ name: tc.name, content: `[TOOL_LIMIT] 调用次数已达上限 (${this.#MAX_SAME_CALL})` })
          continue
        }

        const tool = tools.find(t => (t.name || t.toolDef?.function?.name) === tc.name)
        if (!tool) {
          toolResults.push({ name: tc.name, content: `[TOOL_NOT_FOUND] 工具 "${tc.name}" 未安装` })
          continue
        }

        const result = await this.#executeTool(tool, tc.args, event, toolContext)
        toolResults.push({ name: tc.name, content: result })
      }

      // 工具结果写入历史
      const toolMsg = {
        id: randomUUID(),
        role: 'tool',
        conversationId,
        content: toolResults.map(tr => ({
          type: 'toolCallResult',
          name: tr.name,
          content: tr.content
        })),
        timestamp: Date.now()
      }
      await this.storage.saveHistory(toolMsg)

      // 重新获取完整历史并再次调用
      histories = await this.storage.getHistory(conversationId, 100)
      currentResponse = await this._sendMessage(histories, { ...options, tools: toolDefs })
      currentResponse.id = currentResponse.id || randomUUID()
      currentResponse.conversationId = conversationId
      await this.storage.saveHistory(currentResponse)
    }

    // 7. 提取最终文本
    const finalText = this._extractText(currentResponse)

    return { response: currentResponse, finalText }
  }

  // ── 工具执行（可被子类覆盖） ──────────────────

  /**
   * 执行单个工具调用
   * @param {Object} tool - 工具实例 { name, toolDef, run }
   * @param {Object} args - 工具参数
   * @param {Object} [event] - Yunzai 事件上下文
   * @param {Object} [toolContext] - 额外工具上下文（如 anythingllm 客户端）
   * @returns {Promise<string>}
   */
  async #executeTool (tool, args, event, toolContext) {
    try {
      const runFn = typeof tool.run === 'function' ? tool.run : tool
      if (!runFn) throw new Error(`工具 ${tool.name} 没有 run() 方法`)

      // 构建上下文：工具可通过第二个参数拿到事件和额外客户端
      const context = { ...toolContext }
      if (event) context.event = event

      const start = Date.now()
      const result = await runFn(args, context)
      const duration = Date.now() - start

      this.logger(`[loli] tool ${tool.name}(${duration}ms): ${JSON.stringify(args).slice(0, 60)} → ${typeof result === 'string' ? result.slice(0, 40) : 'object'}`)

      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (err) {
      this.logger(`[loli] tool ${tool.name} error: ${err.message}`)
      return `[TOOL_ERROR] ${err.message}`
    }
  }

  // ── 工具定义提取 ──────────────────────────────

  /** 将工具实例转为 AI 可用的函数定义数组 */
  #buildToolDefs (tools) {
    return tools.map(t => {
      const def = t.toolDef || t
      if (!def) return null
      // 已是嵌套格式 → 直接返回
      if (def.function) return def
      // 平铺格式 → 包装为 { function: { name, description, parameters } }
      if (def.name) return { function: def }
      return null
    }).filter(Boolean)
  }

  // ── 辅助 ──────────────────────────────────────

  /** @param {UnifiedMessage} msg */
  _hasToolCalls (msg) {
    return (msg.content || []).some(c => c.type === 'toolCall')
  }

  /** @returns {Array<{name:string, args:Object}>} */
  _getToolCalls (msg) {
    return (msg.content || [])
      .filter(c => c.type === 'toolCall')
      .map(c => ({ name: c.name, args: c.args ? JSON.parse(c.args) : {} }))
  }

  _extractText (msg) {
    if (!msg) return ''
    return (msg.content || [])
      .filter(c => (c.type === 'text' || c.type === 'reasoning') && c.text)
      .map(c => c.text)
      .join('\n')
      .replace(/\[usage:.*?\]/g, '')
      .trim()
  }
}
