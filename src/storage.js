/**
 * 统一存储层 — 基于 JSON 文件 + 内存 Map
 * 纯 JS，零 native 依赖，崩溃安全（原子写入）
 *
 * Key 前缀约定:
 *   ch:{id}      — 渠道
 *   pr:{id}      — 预设
 *   tl:{id}      — 工具元信息
 *   hs:{cid}:{mid} — 历史消息
 *   us:{userId}  — 用户状态
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

export class LoliStorage {
  #dataDir
  /** @type {Map<string, any>} */
  #cache = new Map()
  #dirty = false
  #flushTimer = null

  constructor (dataDir) {
    this.#dataDir = dataDir
  }

  /** 打开 */
  open () {
    fs.mkdirSync(this.#dataDir, { recursive: true })
    return this
  }

  /** 关闭 */
  close () {
    clearTimeout(this.#flushTimer)
    if (this.#dirty) this.#flush()
  }

  // ─── 核心 KV ──────────────────────────────────

  async put (key, value) {
    this.#cache.set(key, value)
    this.#dirty = true
    this.#scheduleFlush()
  }

  async get (key) {
    if (this.#cache.has(key)) return this.#cache.get(key)
    // 从文件加载
    const file = this.#keyToFile(key)
    if (fs.existsSync(file)) {
      try {
        const val = JSON.parse(fs.readFileSync(file, 'utf8'))
        this.#cache.set(key, val)
        return val
      } catch {}
    }
    return undefined
  }

  async remove (key) {
    this.#cache.delete(key)
    const file = this.#keyToFile(key)
    try { fs.unlinkSync(file) } catch {}
    this.#dirty = true
  }

  /** 按前缀迭代（内存缓存 + 文件系统） */
  async * iteratePrefix (prefix) {
    const seen = new Set()
    // 1. 内存中已有的优先
    for (const [key, value] of this.#cache.entries()) {
      if (key.startsWith(prefix)) {
        seen.add(key)
        yield { key, value }
      }
    }
    // 2. 文件系统中未缓存的补充
    const dir = this.#prefixToDir(prefix)
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const key = prefix + ':' + f.replace(/\.json$/, '').replace(/\+/g, ':')
      if (seen.has(key)) continue
      const value = await this.get(key)
      if (value !== undefined) yield { key, value }
    }
  }

  /** 获取所有匹配前缀的值 */
  async getAllByPrefix (prefix) {
    const results = []
    for await (const { value } of this.iteratePrefix(prefix)) {
      results.push(value)
    }
    return results
  }

  // ─── 渠道 ──────────────────────────────────────

  listChannels () { return this.getAllByPrefix('ch') }
  getChannel (id) { return this.get('ch:' + id) }
  async saveChannel (ch) {
    ch.id = ch.id || randomUUID()
    await this.put('ch:' + ch.id, ch)
    return ch
  }
  deleteChannel (id) { return this.remove('ch:' + id) }

  // ─── 预设 ──────────────────────────────────────

  listPresets () { return this.getAllByPrefix('pr') }
  getPreset (id) { return this.get('pr:' + id) }
  async savePreset (p) {
    p.id = p.id || randomUUID()
    await this.put('pr:' + p.id, p)
    return p
  }
  deletePreset (id) { return this.remove('pr:' + id) }

  // ─── 工具元信息 ────────────────────────────────

  listToolMetas () { return this.getAllByPrefix('tl') }
  getToolMeta (id) { return this.get('tl:' + id) }
  async saveToolMeta (t) {
    t.id = t.id || randomUUID()
    await this.put('tl:' + t.id, t)
    return t
  }
  deleteToolMeta (id) { return this.remove('tl:' + id) }

  // ─── 历史消息 ──────────────────────────────────

  async saveHistory (msg) {
    const cid = msg.conversationId || 'global'
    const mid = msg.id || randomUUID()
    msg.id = mid
    msg.timestamp = msg.timestamp || Date.now()
    await this.put('hs:' + cid + ':' + mid, msg)
    return msg
  }

  async getHistory (conversationId, limit) {
    this.#flushSync() // 确保内存中的写入可见
    const cid = conversationId || 'global'
    const entries = []
    for await (const { value } of this.iteratePrefix('hs:' + cid)) {
      entries.push(value)
    }
    entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    return limit ? entries.slice(-limit) : entries
  }

  async clearHistory (conversationId) {
    const cid = conversationId || 'global'
    const toDelete = []
    for await (const { key } of this.iteratePrefix('hs:' + cid)) {
      toDelete.push(key)
    }
    for (const k of toDelete) {
      await this.remove(k)
    }
  }

  // ─── 用户状态 ──────────────────────────────────

  getState (userId) { return this.get('us:' + userId) }
  saveState (userId, state) { return this.put('us:' + userId, state) }
  deleteState (userId) { return this.remove('us:' + userId) }

  // ─── 统计 ──────────────────────────────────────

  async stats () {
    let count = 0
    for await (const {} of this.iteratePrefix('')) count++
    return { totalKeys: count, path: this.#dataDir }
  }

  // ─── 内部 ──────────────────────────────────────

  /** 安全的文件路径：Windows 文件名不能含 : */
  #keyToPath (key) {
    return key.replace(/:/g, '+')
  }

  #keyToFile (key) {
    const parts = key.split(':')
    const prefix = parts[0]
    const rest = parts.slice(1).join('+')
    const dir = path.join(this.#dataDir, prefix)
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, rest + '.json')
  }

  #prefixToDir (prefix) {
    return path.join(this.#dataDir, prefix.split(':')[0])
  }

  #scheduleFlush () {
    clearTimeout(this.#flushTimer)
    this.#flushTimer = setTimeout(() => this.#flush(), 2000)
  }

  #flushSync () {
    clearTimeout(this.#flushTimer)
    this.#flush()
  }

  #flush () {
    const entries = [...this.#cache.entries()]
    for (const [key, value] of entries) {
      const file = this.#keyToFile(key)
      // 原子写入：先写 tmp 再 rename
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
      fs.renameSync(tmp, file)
    }
    this.#dirty = false
  }
}
