/**
 * AbstractClient — 消息管道 + 工具调用循环
 * 从 node-chaite clients.ts 精简而来
 *
 * 核心流程:
 *   user msg → _sendMessage() → AI response
 *     ├─ 有 toolCalls → 执行工具 → 结果回传 → 循环
 *     └─ 无 → 返回最终文本
 */
import { randomUUID } from 'crypto'

/** @typedef {import('../types.js').UnifiedMessage} UnifiedMessage */

export class AbstractClient {
  /** @type {LoliStorage} */
  storage
  /** @type {Function[]} 已加载的工具 */
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

  /**
   * 发送消息（含工具调用循环 + 历史管理）
   *
   * @param {Object} params
   * @param {UnifiedMessage} params.userMessage
   * @param {string} params.conversationId
   * @param {Object} params.options - sendMessageOption
   * @param {UnifiedMessage} [params.systemPrompt]
   * @param {Function[]} [params.tools] - 此轮可用的工具
   * @returns {Promise<{response: UnifiedMessage, finalText: string}>}
   */
  async sendMessage ({ userMessage, conversationId, options = {}, systemPrompt, tools = [] }) {
    const MAX_TOOL_ROUNDS = 8
    const MAX_SAME_CALL = 2

    this.tools = tools
    const toolDefs = tools.map(t => t.toolDef || t).filter(Boolean)

    // 1. 加载历史
    let histories = await this.storage.getHistory(conversationId, 50)

    // 2. 注入系统提示
    if (systemPrompt) {
      const lastSys = histories.filter(h => h.role === 'system')
      if (lastSys.length === 0) {
        histories = [systemPrompt, ...histories]
      }
    }

    // 3. 保存用户消息到 LMDB + 追加到历史
    userMessage.id = userMessage.id || randomUUID()
    userMessage.conversationId = conversationId
    await this.storage.saveHistory(userMessage)
    histories.push(userMessage)

    // 4. 首轮调用
    let callCount = {}
    let currentResponse = await this._sendMessage(histories, { ...options, tools: toolDefs })

    // 5. 保存模型响应
    currentResponse.id = currentResponse.id || randomUUID()
    currentResponse.conversationId = conversationId
    await this.storage.saveHistory(currentResponse)

    // 6. 工具调用循环
    let round = 0
    while (this._hasToolCalls(currentResponse) && round < MAX_TOOL_ROUNDS) {
      round++

      // 执行工具
      const toolCalls = this._getToolCalls(currentResponse)
      const toolResults = []
      for (const tc of toolCalls) {
        const key = tc.name
        callCount[key] = (callCount[key] || 0) + 1
        if (callCount[key] > MAX_SAME_CALL) {
          toolResults.push({ name: tc.name, content: '[TOOL_LIMIT] 此工具调用已达上限' })
          continue
        }
        const tool = tools.find(t => (t.name || t.toolDef?.function?.name) === tc.name)
        if (!tool) {
          toolResults.push({ name: tc.name, content: '[TOOL_NOT_FOUND]' })
          continue
        }
        try {
          const fn = typeof tool.run === 'function' ? tool.run : tool
          const result = await fn(tc.args, {/* context passed from plugin */})
          toolResults.push({
            name: tc.name,
            content: typeof result === 'string' ? result : JSON.stringify(result)
          })
        } catch (err) {
          toolResults.push({ name: tc.name, content: `[TOOL_ERROR] ${err.message}` })
        }
      }

      // 工具结果消息
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

    return {
      response: currentResponse,
      finalText
    }
  }

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
