/**
 * lolicon-core 类型定义 (JSDoc)
 * 零 TypeScript 依赖，纯运行时契约
 */

/**
 * @typedef {Object} ChannelConfig
 * @property {string} id
 * @property {string} name
 * @property {'gemini'|'openai'} adapterType
 * @property {string[]} models
 * @property {Object} options - adapter options (apiKey, baseUrl, etc.)
 * @property {'public'|'private'} [visibility='public']
 * @property {'enabled'|'disabled'} [status='enabled']
 */

/**
 * @typedef {Object} PresetConfig
 * @property {string} id
 * @property {string} name
 * @property {string} channelId
 * @property {Object} sendMessageOption
 * @property {string} sendMessageOption.model
 * @property {number} [sendMessageOption.temperature=0.9]
 * @property {number} [sendMessageOption.maxTokens=2048]
 * @property {boolean} [sendMessageOption.enableReasoning=false]
 * @property {'OFF'|'LOW'|'MEDIUM'|'HIGH'} [sendMessageOption.thinkingLevel]
 * @property {'low'|'medium'|'high'} [sendMessageOption.reasoningEffort]
 * @property {Object} [systemPrompt]
 * @property {'enabled'|'disabled'} [status='enabled']
 */

/**
 * @typedef {Object} ToolMeta
 * @property {string} id
 * @property {string} name
 * @property {string} code - source code for hot-reload
 * @property {'enabled'|'disabled'} [status='enabled']
 * @property {Object} toolDef - { type:'function', function:{ name, description, parameters } }
 */

/**
 * @typedef {Object} UnifiedMessage - Chaite 统一消息格式
 * @property {string} id
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {UnifiedContent[]} content
 * @property {string} [conversationId]
 * @property {string} [parentId]
 * @property {number} [timestamp]
 */

/**
 * @typedef {Object} UnifiedContent
 * @property {'text'|'image'|'reasoning'|'toolCall'|'toolCallResult'} type
 * @property {string} [text]
 * @property {string} [mimeType]
 * @property {string} [image] - base64
 * @property {string} [thoughtSignature]
 * @property {string} [toolId]
 * @property {string} [name] - tool name
 * @property {string} [args] - tool call arguments (JSON string)
 * @property {string} [content] - tool call result content
 */

/**
 * @typedef {Object} ToolCallContext
 * @property {Object} event - Yunzai 事件
 * @property {Object} [options]
 * @property {function} [logger]
 */

/**
 * @typedef {Object} EngineConfig
 * @property {string} dataDir
 * @property {string} [toolsDir]
 * @property {Object} [logger]
 */

export const TYPES = null // placeholder for module
