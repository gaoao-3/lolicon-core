/**
 * OpenAI 消息格式转换器
 */
import { randomUUID } from 'crypto'

/**
 * UnifiedMessage → OpenAI ChatCompletionMessageParam
 * @param {UnifiedMessage} msg
 * @returns {Object|null}
 */
export function fromChaiteConverter (msg) {
  if (!msg || !msg.role) return null

  switch (msg.role) {
    case 'system':
      return {
        role: 'system',
        content: msg.content?.[0]?.text || ''
      }
    case 'user': {
      const contents = []
      for (const c of (msg.content || [])) {
        if (c.type === 'text' && c.text) contents.push({ type: 'text', text: c.text })
        if (c.type === 'image' && c.image) {
          contents.push({
            type: 'image_url',
            image_url: { url: `data:${c.mimeType || 'image/jpeg'};base64,${c.image}` }
          })
        }
      }
      return contents.length > 0 ? { role: 'user', content: contents } : null
    }
    case 'assistant': {
      const toolCalls = []
      let textContent = ''
      for (const c of (msg.content || [])) {
        if ((c.type === 'text' || c.type === 'reasoning') && c.text) {
          textContent += c.text + '\n'
        }
        if (c.type === 'toolCall') {
          toolCalls.push({
            id: c.toolId || ('call_' + randomUUID().slice(0, 8)),
            type: 'function',
            function: {
              name: c.name || '',
              arguments: c.args || '{}'
            }
          })
        }
      }
      const result = { role: 'assistant', content: textContent.trim() || null }
      if (toolCalls.length > 0) result.tool_calls = toolCalls
      return result.content || toolCalls.length > 0 ? result : null
    }
    case 'tool': {
      return msg.content.map(tcr => ({
        role: 'tool',
        tool_call_id: tcr.toolId || '',
        content: tcr.content || ''
      }))
    }
    default:
      return null
  }
}

/**
 * OpenAI ChatCompletion → UnifiedMessage
 * @param {Object} choice
 * @param {string} [model]
 * @returns {UnifiedMessage}
 */
export function intoChaiteConverter (choice, model) {
  const id = randomUUID()
  const message = choice.message || {}
  const content = []

  if (message.content) {
    content.push({ type: 'text', text: message.content })
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      content.push({
        type: 'toolCall',
        toolId: tc.id,
        name: tc.function?.name,
        args: tc.function?.arguments || '{}'
      })
    }
  }

  return {
    id,
    role: 'assistant',
    content,
    timestamp: Date.now()
  }
}

/**
 * 提取 toolCalls
 * @param {UnifiedMessage} msg
 * @returns {Array<{name:string, args:Object, toolId:string}>}
 */
export function extractToolCalls (msg) {
  if (!msg || msg.role !== 'assistant') return []
  return (msg.content || [])
    .filter(c => c.type === 'toolCall')
    .map(c => ({ name: c.name, args: c.args ? JSON.parse(c.args) : {}, toolId: c.toolId }))
}

export function extractText (msg) {
  if (!msg) return ''
  return (msg.content || [])
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text)
    .join('\n')
}
