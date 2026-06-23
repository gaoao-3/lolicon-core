/**
 * OpenAI API 客户端
 */
import OpenAI from 'openai'
import { AbstractClient } from './abstract.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/openai.js'

export class OpenAIClient extends AbstractClient {
  get adapterType () { return 'openai' }

  async _sendMessage (histories, options = {}) {
    const apiKey = this.options.apiKey
    if (!apiKey) throw new Error('OpenAI API key not configured')

    const model = options.model || this.options.model || 'gpt-4o'
    const temperature = options.temperature ?? 0.9
    const maxTokens = options.maxTokens || 2048

    const client = new OpenAI({
      apiKey,
      baseURL: this.options.baseUrl || undefined
    })

    const messages = []
    for (const h of histories) {
      const converted = fromChaiteConverter(h)
      if (Array.isArray(converted)) {
        messages.push(...converted)
      } else if (converted) {
        messages.push(converted)
      }
    }

    // 工具
    const toolDefs = (options.tools || []).map(t => {
      const def = t.toolDef || t
      if (!def?.function) return null
      return {
        type: 'function',
        function: {
          name: def.function.name,
          description: def.function.description,
          parameters: def.function.parameters
        }
      }
    }).filter(Boolean)

    /** @type {Object} */
    const params = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    }
    if (options.topP !== undefined) params.top_p = options.topP
    if (toolDefs.length > 0) {
      params.tools = toolDefs
      params.tool_choice = 'auto'
    }

    const completion = await client.chat.completions.create(params)
    return intoChaiteConverter(completion.choices[0], model)
  }
}
