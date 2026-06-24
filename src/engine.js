/**
 * LoliEngine — lolicon-core 主入口
 * 统一管理：存储 / 渠道 / 客户端 / 工具 / 历史
 */
import { LoliStorage } from './storage.js'
import { ToolLoader } from './loaders/tools.js'
import { GeminiClient } from './clients/gemini.js'
import { OpenAIClient } from './clients/openai.js'
import { AnythingLLMClient } from './clients/anythingllm.js'
import { v4 as uuidv4 } from 'uuid'
import { Memory } from './memory/index.js'

export class LoliEngine {
  /** @type {LoliStorage} */
  storage
  /** @type {ToolLoader} */
  toolLoader
  /** @type {Map<string, AbstractClient>} */
  #clients = new Map()
  /** @type {Memory|null} */
  #memory = null
  /** @type {AbstractClient|null} */
  #currentClient = null
  /** @type {AnythingLLMClient|null} */
  #anythingllm = null
  /** @type {Object} */
  #opts

  /**
   * @param {Object} opts
   * @param {string} opts.dataDir
   * @param {string} [opts.toolsDir]
   * @param {Function} [opts.logger] - (msg) => void
   * @param {boolean} [opts.enableMemory=true]
   * @param {Object} [opts.master] - 主人配置 { userId, label, aliases }
   * @param {Object} [opts.anythingllm] - AnythingLLM 配置 { baseUrl, apiKey, workspace }
   */
  constructor (opts = {}) {
    this.#opts = opts
    this.storage = new LoliStorage(opts.dataDir).open()
    this.toolLoader = new ToolLoader({
      toolsDir: opts.toolsDir || opts.dataDir + '/tools',
      logger: opts.logger
    })
    if (opts.enableMemory !== false) {
      this.#memory = new Memory({
        storage: this.storage,
        extractFn: (prompt) => this.#extractMemory(prompt),
        logger: opts.logger,
        master: opts.master
      })
    }
    if (opts.anythingllm?.baseUrl && opts.anythingllm?.apiKey) {
      this.#anythingllm = new AnythingLLMClient({
        baseUrl: opts.anythingllm.baseUrl,
        apiKey: opts.anythingllm.apiKey,
        workspace: opts.anythingllm.workspace || 'default',
        logger: opts.logger
      })
    }
  }

  /** 初始化（加载工具 + 记忆） */
  async init () {
    await this.toolLoader.init()
    if (this.#memory) await this.#memory.init()
    return this
  }

  /** 清理资源 */
  async destroy () {
    await this.toolLoader.destroy()
    if (this.#memory) await this.#memory.destroy()
    this.storage.close()
    this.#clients.clear()
  }

  /**
   * 调用当前客户端进行记忆提取
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async #extractMemory (prompt) {
    if (!this.#currentClient) return ''
    try {
      const msg = {
        id: uuidv4(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now()
      }
      const result = await this.#currentClient._sendMessage([msg], {
        model: 'gemini-2.5-flash',
        temperature: 0.2
      })
      return (result.content || [])
        .filter(c => c.type === 'text' || c.type === 'reasoning')
        .map(c => c.text)
        .join('\n')
        .replace(/\[usage:.*?\]/g, '')
        .trim()
    } catch (err) {
      this.#opts.logger?.(`[memory] extract error: ${err.message}`)
      return ''
    }
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
   * @param {string} [params.userId] - 用于记忆召回
   * @param {string} [params.groupId] - 用于记忆召回
   * @param {Object} [params.event] - Yunzai 事件
   * @param {Object} [params.overrideOptions] - 覆盖 preset 的选项
   * @returns {Promise<{response: UnifiedMessage, finalText: string}>}
   */
  async sendMessage ({ channelId, presetId, conversationId, userMessage, userId, groupId, event, overrideOptions = {} }) {
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
    this.#currentClient = client

    // 会话 ID
    const cid = conversationId || uuidv4()

    // 工具（全部已加载的工具）
    const tools = this.toolLoader.getAll()

    // 从事件中补全 userId / groupId
    if (event) {
      if (!userId && event.user_id) userId = String(event.user_id)
      if (!groupId && event.group_id) groupId = String(event.group_id)
    }

    // 记忆召回并注入 system prompt
    if (this.#memory) {
      const userText = this.#extractUserText(userMessage)
      const memoryText = this.#memory.recall({ userId, groupId, queryText: userText, limit: 8 })
      if (memoryText && systemPrompt) {
        systemPrompt = this.#memory.injector.inject(systemPrompt, memoryText)
      }
    }

    // 发送（注入 AnythingLLM 客户端到工具上下文）
    const toolContext = { event, anythingllm: this.#anythingllm }
    const result = await client.sendMessage({
      userMessage,
      conversationId: cid,
      options: sendOpts,
      systemPrompt,
      tools,
      event,
      toolContext
    })

    // 异步提取并保存记忆
    if (this.#memory) {
      const userText = this.#extractUserText(userMessage)
      const assistantText = result.finalText
      this.#memory.record({ userText, assistantText, event }).catch(() => {})
    }

    return result
  }

  #extractUserText (userMessage) {
    if (!userMessage) return ''
    return (userMessage.content || [])
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n')
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

  // ─── AnythingLLM 集成 ────────────────────────────

  /**
   * 设置 AnythingLLM 客户端（运行时注入）
   * @param {Object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.apiKey
   * @param {string} [opts.workspace='default']
   */
  setAnythingLLM (opts) {
    this.#anythingllm = new AnythingLLMClient({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      workspace: opts.workspace || 'default',
      logger: this.#opts.logger
    })
  }

  /** 获取 AnythingLLM 客户端实例 */
  getAnythingLLM () {
    return this.#anythingllm
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

  /** 导出可读的记忆图谱 Markdown */
  getMemoryMarkdown () {
    return this.#memory ? this.#memory.toMarkdown() : ''
  }

  /** 获取记忆实例（用于管理面板） */
  getMemory () {
    return this.#memory
  }
}
