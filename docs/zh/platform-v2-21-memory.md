# v2-21 规格：可替换的记忆

状态：已实现（2026-10-27），未部署；用户已确认范围。依赖 [v2-14](platform-v2-14-contributions-events.md)、[v2-16](platform-v2-16-module-secrets-requests.md)、[v2-20](platform-v2-20-system-apps.md)。验证记录见 `.agent-artifacts/v2-21-spike/notes.md`。

## 1. 背景与原则

Chrona 现在只有一张平铺的 `preferences` 表。用户不想再维护一套记忆系统，也可能想接入自己正在用的（Hindsight、Mem0 OpenMemory、Basic Memory 等）。调研结论：记忆系统没有统一标准，主流系统都提供“存、搜、删”三类操作，只是名称和接入方式不同（MCP、HTTP、SDK）。

因此：

- Chrona **不实现记忆系统**，只定义一个很小的记忆接口；去重、冲突、整理、向量都由提供者负责。
- 提供者是普通模块：内置一个可选的（包装 mnemopi），外部系统由 Chrona 构建适配模块接入。换系统只换模块，内核不变。
- 未启用记忆时一切照旧。

## 2. 记忆接口

提供者模块在 manifest 声明 `contributes: { memory: { interface: 1 } }`，并提供三个工具（`callers: ["memory"]`，只给内核的 memory 系统模块调用）：

| 工具 | 输入 | 输出 |
|---|---|---|
| `retain` | `content`（≤4000 字）、`source`（来源说明，如“对话 web:…”“反思”）、`at`（ISO 时间） | `{ id }` |
| `recall` | `query`、`limit`（≤20） | `{ items: [{ id, content, at?, score? }] }` |
| `forget` | `id` | `{ forgotten: boolean }` |

## 3. 内核：系统模块 `memory`

- 设置 `memory = { provider: 模块名 | null }`，默认 `null`。只接受声明了 `contributes.memory` 且三个工具齐全的活动模块。
- 工具（转发给提供者）：
  - `memory.recall({ query, limit? })`、`memory.retain({ content })`、`memory.forget({ id })`：Chrona（Provider）可用，在对话中以 `m_memory_*` 出现（未启用时不出现）；网页与 MCP 也可用（`callers: ["web", "mcp"]`）。写入内容先经敏感信息清理。
  - `memory.status()`：当前设置、是否可用、24 小时内写入/检索/删除次数；仅网页与 MCP。
  - 提供者工具 `visibility: ["kernel"]`，只有内核能调用；外部适配模块同样如此。
  - `retain` 由内核补上 `source`（哪类会话、会话 id）与时间，模型不能伪造来源。
- 提供者不可用或超时：工具返回错误，对话照常继续，不重试。
- 记忆内容是**数据**：`recall` 的结果和网页、邮件一样，不能作为指令或授权。
- 审计只记次数和来源（`memory_retained` / `memory_forgotten`，不含内容）；系统应用页显示提供者、可用性与近期操作次数，并提供检索框和删除。
- 记忆系统模块的说明进入 v2-20 的系统应用列表。

## 4. Chrona 怎么用

参照 oh-my-pi 的记忆层（`@oh-my-pi/pi-coding-agent` 18.13.1：统一的 `MemoryBackend`，后端互斥可换；mnemopi 后端默认自动检索与自动写入，另有工具；后端失败只记日志、不影响对话）。

- 只对**对话会话**（web、qq、mcp）自动存取；构建、反思、模块唤醒会话不自动存取。
- **自动检索**（`memory.autoRecall`，默认开）：一个会话的第一轮运行开始前，用这条消息加最近 3 轮对话拼成检索词（截断到 1000 字），`recall` 最多 8 条，作为“记忆（数据）”放进提示词。只在第一轮做；结果记在审计里，同一会话后续运行不重复检索。失败或超时（5 秒）就不带记忆继续。
- **自动写入**（`memory.autoRetain`，默认开）：对话运行结束时，若自上次写入以来又有 4 条用户消息（`retainEveryNTurns`），把这段还没写入的对话（用户与 Chrona 的文字，不含工具结果与附件内容）经现有敏感信息清理（`redactSensitiveText`）后 `retain`，`source` 为会话。写入位置记在审计里，避免重复写入。提取事实由提供者负责（mnemopi 无模型时用内置规则；Hindsight 等外部系统自行提取），Chrona 不额外调用模型。
- **工具**：Chrona 仍可主动 `m_memory_recall`（给关键词，可换说法多次检索，弥补全文检索对整句提问的不足）、`m_memory_retain`、`m_memory_forget`。提示词说明：涉及过去的决定、偏好、项目背景时先检索；值得长期记住的事实、决定与结果主动写入；不写入凭据。
- `preferences`（chrona_remember）保留：它是少量、每次都放进上下文的规则；记忆是可检索的长期内容。
- 反思（v2-19）本版不改。

## 5. 内置提供者 `memory-local`（mnemopi）

- 内置模块，包装 `@oh-my-pi/pi-mnemopi`（MIT，Bun，bun:sqlite），`package.json` 与 `bun.lock` **锁定 18.13.1**，升级另行评估（上游 5 个月 262 个版本）。
- **启用时才安装**：随发布只带源码和锁文件；`registerBuiltins` 跳过它，直到用户把 `memory.provider` 设为 `memory-local`。之后照常注册、构建（`bun install --frozen-lockfile --ignore-scripts`，约 262 MB，其中原生扩展 224 MB），通过检查后上线。关闭时模块暂停，数据保留在模块数据目录。
- 存储：模块数据目录下 `memory.db`，bank 固定 `chrona`。
- 默认只用全文检索（`noEmbeddings`）。远程向量可配置，不需要再构建：
  - params：`embeddingApiUrl`、`embeddingModel`（如多语言 e5 系列）；
  - 凭据 `memory_embedding`：`{ apiKey }`（v2-16，可在网页设置）；
  - 两者都有时启用向量，否则仅全文检索。
- 声明 `network` effect（远程向量需要；用户确认联网无需严格限制）。
- 不用 mnemopi 的 LLM 路径（用其内置规则）；每天一次 `sleep` 整理（模块 schedule 触发器）。
- 本机向量（fastembed / onnxruntime，约 500 MB 依赖 + 2 GB 模型）不在本版。
- **内存地址空间上限**：模块沙箱用 `ulimit -v` 限制地址空间，默认 1024 MB。Bun 启动即预留约 2.8 GB 地址空间（受限时自动少要），mnemopi 的原生扩展在 1–3.5 GB 限制下加载失败（`failed to map segment from shared object`），4 GB 可以；加载后实际内存约 110 MB。为此 manifest 新增 `limits.virtualMemoryMb`（1024–8192），`memory-local` 声明 4096。它用于常驻进程、启动检查与作者测试（取与测试默认 2048 的较大值）；审批卡预览显示，新增或提高时列入“新增能力”。其他模块不变。数据迁移脚本仍用默认上限。
- 实测（本机，Chrona 真实构建流程）：依赖安装、作者测试、启动检查通过并上线；经内核 `memory.retain` / `memory.recall` 存取中文记忆正常。

## 6. 外部提供者

用户说“接入我的 Hindsight / Mem0 …”时，Chrona 用 `modules.build` 构建适配模块：实现 §2 的三个工具，把它们翻译成该系统的 MCP 或 HTTP 调用；地址和密钥用 params 与凭据。上线照常分级审批，审批卡写明数据发往哪里。

## 7. 网页

- 设置页：“记忆”下拉框（不启用 / 内置 / 已安装的适配模块），选内置时说明会下载约 262 MB。
- 系统应用 `memory` 页：提供者与状态、检索框、结果可删除、近期写入/检索次数。
- 线上定制 web 需另经构建合并。

## 8. 不在本版

- 上下文压缩前检索（oh-my-pi 有，Chrona 的对话运行目前不做跨运行的压缩）。
- 反思读写记忆、把对话反馈作为反思信号。
- 本机向量、记忆导入导出、把 `preferences` 迁移进记忆。
