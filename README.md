# lolicon-core

轻量级 AI 对话引擎 — JSON 文件存储 + Gemini/OpenAI 客户端 + 工具热加载 + 结构化记忆。

## 特性

- **零 native 依赖**：纯 JavaScript，无需 SQLite/LowDB/LevelDB。
- **JSON + 内存 Map 存储**：原子写入，崩溃安全。
- **多模型适配**：Gemini、OpenAI、AnythingLLM（工具上下文注入）。
- **工具热加载**：chokidar 监听 `tools/` 目录，新增/修改/删除实时生效。
- **结构化记忆**：实体-关系图谱、双轨召回（关系链 + 关键词）、主人优先召回。
- **Thinking 模式**：支持 Gemini 等模型的推理/思考内容。

## 安装

```bash
npm install lolicon-core
```

要求 Node.js >= 22。

## 快速开始

```javascript
import { createEngine } from 'lolicon-core'

const engine = new createEngine({
  dataDir: './data',
  toolsDir: './tools',
  logger: (msg) => console.log(msg)
})
await engine.init()

const reply = await engine.chat('你好', { channelId: 'gemini', presetId: 'hina' })
console.log(reply)

await engine.destroy()
```

## 管理面板

管理面板已集成到 [loli-plugin](https://github.com/gaoao-3/loli-plugin) 中。启动 Yunzai 后，loli-plugin 会自动拉起面板服务，访问地址：

```
http://localhost:3000
```

面板配置位于 `loli-plugin/data/config.json` 的 `dashboard` 字段：

```json
{
  "dashboard": {
    "enable": true,
    "port": 3000,
    "host": "0.0.0.0",
    "authToken": ""
  }
}
```

## 项目结构

```
lolicon-core/
├── src/
│   ├── engine.js          # 主引擎
│   ├── storage.js         # JSON 存储
│   ├── clients/           # AI 客户端
│   ├── loaders/           # 工具加载器
│   └── memory/            # 记忆系统
├── index.js               # 入口导出
├── test-memory.js         # 记忆系统测试
└── package.json
```

## 测试

```bash
npm test
```

## 许可证

MIT
