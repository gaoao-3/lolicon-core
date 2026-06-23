/**
 * LoliEngine — lolicon-core 主入口
 * 统一管理：存储 / 渠道 / 客户端 / 工具 / 历史
 */
import { LoliStorage } from './storage.js'
import { ToolLoader } from './loaders/tools.js'
import { GeminiClient } from './clients/gemini.js'
import { OpenAIClient } from './clients/openai.js'
import { v4 as uuidv4 } from 'uuid'

export class LoliEngine {
  /** @type {LoliStorage} */
  storage
  /** @type {ToolLoader} */
  toolLoader
  /** @type {Map<string, AbstractClient>} */
  #clients = new Map()
  /** @type {Object} */
  #opts

  /**
   * @param {Object} opts
   * @param {string} opts.dataDir
   * @param {string} [opts.toolsDir]
   * @param {Function} [opts.logger] - (msg) => void
   */
  constructor (opts = {}) {
    this.#opts = opts
    this.storage = new LoliStorage(opts.dataDir).open()
    this.toolLoader = new ToolLoader({
      toolsDir: opts.toolsDir || opts.dataDir + '/tools',
      logger: opts.logger
    })
  }

  /** 初始化（加载工具） */
  async init () {
    await this.toolLoader.init()
    return this
  }

  /** 清理资源 */
  async destroy () {
    await this.toolLoader.destroy()
    this.storage.close()
    this.#clients.clear()
  }

  /**
   * 获取或创建客户端
   * @param {string} channelId
   * @returns {Promise<AbstractClient>}
   */
  async getClient (channelId) {
    if (this.#clients.has(channelId)) return this.#clients.get(channelId)

    const channel = await this.storage.getChannel(channelId)
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    const opts = {
      storage: this.storage,
      options: channel.options || {},
      logger: this.#opts.logger
    }

    let client
    const adapter = channel.adapterType || 'gemini'
    if (adapter === 'gemini') {
      client = new GeminiClient(opts)
    } else if (adapter === 'openai') {
      client = new OpenAIClient(opts)
    } else {
      throw new Error(`Unsupported adapter: ${adapter}`)
    }

    this.#clients.set(channelId, client)
    return client
  }

  /**
   * 发送 AI 消息（完整管道）
   *
   * @param {Object} params
   * @param {string} params.channelId
   * @param {string} [params.presetId]
   * @param {string} [params.conversationId]
   * @param {UnifiedMessage} params.userMessage
   * @param {Object} [params.event] - Yunzai 事件
   * @param {Object} [params.overrideOptions] - 覆盖 preset 的选项
   * @returns {Promise<{response: UnifiedMessage, finalText: string}>}
   */
  async sendMessage ({ channelId, presetId, conversationId, userMessage, event, overrideOptions = {} }) {
    // 加载渠道
    const channel = await this.storage.getChannel(channelId)
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    // 加载预设
    let sendOpts = overrideOptions
    let systemPrompt = null

    if (presetId) {
      const preset = await this.storage.getPreset(presetId)
      if (preset) {
        sendOpts = { ...(preset.sendMessageOption || {}), ...overrideOptions }
        if (preset.systemPrompt?.content) {
          systemPrompt = {
            id: 'system-' + presetId,
            role: 'system',
            content: [{ type: 'text', text: preset.systemPrompt.content }],
            timestamp: Date.now()
          }
        }
      }
    }

    // 确保 model
    if (!sendOpts.model) {
      sendOpts.model = channel.models?.[0] || 'gemini-2.5-flash'
    }

    // 获取客户端
    const client = await this.getClient(channelId)

    // 会话 ID
    const cid = conversationId || uuidv4()

    // 工具（全部已加载的工具）
    const tools = this.toolLoader.getAll()

    // 发送
    return client.sendMessage({
      userMessage,
      conversationId: cid,
      options: sendOpts,
      systemPrompt,
      tools,
      event           // ← 传递 Yunzai 事件给客户端 → 工具
    })
  }

  /**
   * 快捷：纯文本发送
   * @param {string} text
   * @param {Object} opts
   * @returns {Promise<string>}
   */
  async chat (text, opts = {}) {
    const userMsg = {
      id: uuidv4(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now()
    }
    const result = await this.sendMessage({
      ...opts,
      userMessage: userMsg
    })
    return result.finalText
  }

  // ─── 快捷方法 ──────────────────────────────────

  getHistory (conversationId, limit) {
    return this.storage.getHistory(conversationId, limit)
  }

  clearHistory (conversationId) {
    return this.storage.clearHistory(conversationId)
  }

  saveChannel (ch) { return this.storage.saveChannel(ch) }
  listChannels () { return this.storage.listChannels() }
  savePreset (p) { return this.storage.savePreset(p) }
  listPresets () { return this.storage.listPresets() }
}
