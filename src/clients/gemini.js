/**
 * Gemini API 客户端
 * 基于 @google/genai SDK
 */
import { GoogleGenAI } from '@google/genai'
import { AbstractClient } from './abstract.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/gemini.js'

export class GeminiClient extends AbstractClient {
  get adapterType () { return 'gemini' }

  /**
   * 发送消息到 Gemini API
   * @param {UnifiedMessage[]} histories
   * @param {Object} options
   * @returns {Promise<UnifiedMessage>}
   */
  async _sendMessage (histories, options = {}) {
    const apiKey = this.options.apiKey
    if (!apiKey) throw new Error('Gemini API key not configured')

    const model = options.model || this.options.model || 'gemini-2.5-flash'
    const temperature = options.temperature ?? 0.9
    const maxOutputTokens = options.maxTokens || 2048

    // 初始化客户端
    const genAI = new GoogleGenAI({
      apiKey,
      httpOptions: { baseUrl: this.options.baseUrl || undefined }
    })

    // 转换消息
    const contents = histories
      .map(h => fromChaiteConverter(h))
      .filter(Boolean)

    // 转换工具
    const toolDeclarations = (options.tools || [])
      .map(t => {
        const def = t.toolDef || t
        if (!def?.function) return null
        return {
          name: def.function.name,
          description: def.function.description,
          parameters: def.function.parameters
        }
      })
      .filter(Boolean)

    // 构建请求
    /** @type {Object} */
    const generateConfig = {
      model,
      contents,
      config: {
        temperature,
        maxOutputTokens,
        ...(options.topP !== undefined ? { topP: options.topP } : {})
      }
    }

    // 思考模式
    if (options.enableReasoning) {
      const effort = {
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH'
      }[options.reasoningEffort] || 'LOW'

      generateConfig.config.thinkingConfig = {
        thinkingBudget: effort === 'HIGH' ? 2048 : effort === 'MEDIUM' ? 1024 : 512,
        includeThoughts: true
      }
    }

    // 工具声明
    if (toolDeclarations.length > 0) {
      generateConfig.config.tools = [{ functionDeclarations: toolDeclarations }]
    }

    // 系统提示 → 放在第一个 user content 前
    const sysMsg = histories.find(h => h.role === 'system')
    if (sysMsg && contents.length > 0) {
      generateConfig.config.systemInstruction = {
        parts: [{ text: sysMsg.content?.[0]?.text || '' }]
      }
    }

    try {
      const response = await genAI.models.generateContent(generateConfig)
      return intoChaiteConverter(response, model)
    } catch (err) {
      // Gemini SDK 有时把非正常响应包进 Error
      if (err.message?.includes('candidates') || err.status === 400) {
        this.logger?.warn?.('[Gemini] API error:', err.message?.slice(0, 200))
      }
      throw err
    }
  }
}
