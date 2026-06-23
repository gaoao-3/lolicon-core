/**
 * Gemini 消息格式转换器
 * 在 Chaite 统一格式 ↔ Gemini Content/Part 之间转换
 */
import { randomUUID } from 'crypto'

/**
 * UnifiedMessage → Gemini Content[]
 * @param {UnifiedMessage} msg
 * @returns {import('@google/genai').Content}
 */
export function fromChaiteConverter (msg) {
  if (!msg || !msg.role) return null

  switch (msg.role) {
    case 'system': {
      return {
        role: 'user',
        parts: [{ text: '[系统] ' + (msg.content?.[0]?.text || '') }]
      }
    }
    case 'user': {
      const parts = []
      for (const c of (msg.content || [])) {
        switch (c.type) {
          case 'text': {
            if (typeof c.text === 'string' && c.text.trim()) {
              parts.push({ text: c.text })
            }
            break
          }
          case 'image': {
            parts.push({
              inlineData: {
                mimeType: c.mimeType || 'image/jpeg',
                data: c.image
              }
            })
            break
          }
        }
      }
      return parts.length > 0 ? { role: 'user', parts } : null
    }
    case 'assistant': {
      const parts = []
      for (const c of (msg.content || [])) {
        switch (c.type) {
          case 'text': {
            if (typeof c.text === 'string' && c.text.trim()) {
              /** @type {import('@google/genai').Part} */
              const part = { text: c.text }
              if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
              parts.push(part)
            }
            break
          }
          case 'reasoning': {
            if (typeof c.text === 'string' && c.text.trim()) {
              /** @type {import('@google/genai').Part} */
              const part = { text: c.text }
              if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
              parts.push(part)
            }
            break
          }
          case 'image': {
            /** @type {import('@google/genai').Part} */
            const part = {
              inlineData: {
                mimeType: c.mimeType || 'image/jpeg',
                data: c.image
              }
            }
            if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
            parts.push(part)
            break
          }
          case 'toolCall': {
            /** @type {import('@google/genai').Part} */
            const part = {
              functionCall: {
                name: c.name || '',
                args: c.args ? JSON.parse(c.args) : {}
              }
            }
            if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
            parts.push(part)
            break
          }
        }
      }
      return parts.length > 0 ? { role: 'model', parts } : null
    }
    case 'tool': {
      return {
        role: 'user',
        parts: msg.content.map(tcr => ({
          functionResponse: {
            name: tcr.name || '',
            response: { content: tcr.content || '' }
          }
        }))
      }
    }
    default:
      return null
  }
}

/**
 * Gemini GenerateContentResponse → UnifiedMessage
 * @param {import('@google/genai').GenerateContentResponse} response
 * @param {string} [model]
 * @returns {UnifiedMessage}
 */
export function intoChaiteConverter (response, model) {
  const id = randomUUID()
  const content = []

  if (!response.candidates?.[0]?.content?.parts) {
    return {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      timestamp: Date.now()
    }
  }

  for (const part of response.candidates[0].content.parts) {
    if (part.text !== undefined && part.text !== null) {
      // 检查是否是 reasoning/thought
      const isReasoning = part.thought === true
      content.push({
        type: isReasoning ? 'reasoning' : 'text',
        text: part.text,
        thoughtSignature: part.thoughtSignature || undefined
      })
    } else if (part.functionCall) {
      content.push({
        type: 'toolCall',
        name: part.functionCall.name,
        args: JSON.stringify(part.functionCall.args || {}),
        thoughtSignature: part.thoughtSignature || undefined
      })
    }
  }

  // Usage metadata (optional)
  if (response.usageMetadata) {
    content.push({
      type: 'text',
      text: `[usage: ${response.usageMetadata.totalTokens || '?'} tokens @ ${model || 'gemini'}]`
    })
  }

  return {
    id,
    role: 'assistant',
    content,
    timestamp: Date.now()
  }
}

/**
 * 提取 toolCalls 列表
 * @param {UnifiedMessage} msg
 * @returns {Array<{name:string, args:Object}>}
 */
export function extractToolCalls (msg) {
  if (!msg || msg.role !== 'assistant') return []
  return (msg.content || [])
    .filter(c => c.type === 'toolCall')
    .map(c => ({ name: c.name, args: c.args ? JSON.parse(c.args) : {} }))
}

/**
 * 提取纯文本内容（含 reasoning）
 * @param {UnifiedMessage} msg
 * @returns {string}
 */
export function extractText (msg) {
  if (!msg) return ''
  return (msg.content || [])
    .filter(c => (c.type === 'text' || c.type === 'reasoning') && c.text)
    .map(c => c.text)
    .join('\n')
}
