下面这份只写 **OpenClaw 在 OpenResponses HTTP API
兼容层里“特殊/非通用”的部分**。标准 OpenAI Responses API 里已有的通用概念，比如
`input`、`stream`、SSE 基本格式、普通 function tools schema，我只在和 OpenClaw
行为有关时提一下。

# OpenClaw OpenResponses HTTP API：OpenClaw 特有行为说明

## 1. 定位：这是 Gateway 上的兼容入口，不是独立服务

OpenClaw Gateway 可以暴露一个 OpenResponses-compatible 的 HTTP endpoint：

```http
POST /v1/responses
```

它和 Gateway 共用同一个端口，路径形如：

```text
http://<gateway-host>:<port>/v1/responses
```

这个 endpoint **默认关闭**，需要显式开启配置项
`gateway.http.endpoints.responses.enabled`。它收到请求后，底层会作为普通 Gateway
agent run 执行，也就是和 `openclaw agent` 使用同一套执行路径，因此会继承当前
Gateway 的 routing、permissions 和 config。([OpenClaw][1])

**理解方式：**

```text
外部 HTTP 调用方
  ↓ POST /v1/responses
OpenClaw Gateway HTTP compatibility layer
  ↓
OpenClaw Gateway agent run
  ↓
返回 OpenResponses 风格 response / SSE
```

它不是完整 Gateway API 的替代品；完整控制面仍然是 Gateway WebSocket
协议。Gateway WS 是 OpenClaw 的 single control plane + node transport，所有
CLI、Web UI、macOS app、iOS/Android nodes、headless nodes 都通过 WS
接入并在握手时声明 role 和 scope。([OpenClaw][2])

---

## 2. 启用方式

OpenResponses endpoint 需要在 Gateway 配置里开启：

```ts
{
  gateway: {
    http: {
      endpoints: {
        responses: {
          enabled: true;
        }
      }
    }
  }
}
```

文档明确说 `/v1/responses` 默认 disabled，需要先在 config
中启用。([OpenClaw][1])

同一套兼容 surface 还包括：

```text
GET  /v1/models
GET  /v1/models/{id}
POST /v1/embeddings
POST /v1/chat/completions
```

这些不是 OpenResponses 本身的全部重点，但在 OpenClaw Gateway HTTP
兼容层里一起出现。([OpenClaw][1])

---

## 3. OpenClaw 的认证和权限映射

OpenResponses HTTP API 使用 Gateway 的 HTTP auth path。OpenClaw
特殊之处在于：这个 endpoint 会被视为对当前 Gateway instance 的 **full operator
access**，尤其在共享密钥模式下会恢复默认 operator scope。([OpenClaw][1])

### 3.1 共享密钥模式

如果 Gateway 使用：

```text
gateway.auth.mode = "token"
gateway.auth.mode = "password"
```

请求使用：

```http
Authorization: Bearer <token-or-password>
```

在这种模式下，OpenClaw 会认为调用方证明了自己持有 Gateway operator
secret，并恢复 full default operator scopes：

```text
operator.admin
operator.approvals
operator.pairing
operator.read
operator.talk.secrets
operator.write
```

同时，文档说明：共享密钥模式下会忽略更窄的 `x-openclaw-scopes`，恢复正常 full
operator 默认 scope。([OpenClaw][1])

### 3.2 Trusted proxy / private ingress

如果 Gateway 使用 trusted identity-bearing HTTP mode，例如：

```text
gateway.auth.mode = "trusted-proxy"
```

或者在私有入口使用：

```text
gateway.auth.mode = "none"
```

OpenClaw 会在存在 `x-openclaw-scopes` 时尊重该 header；如果没有，则 fallback
到正常 operator default scope set。([OpenClaw][1])

### 3.3 实现建议

如果你把 `/v1/responses` 暴露给内部业务系统，建议不要直接把 Gateway owner token
分发给所有系统。更稳妥的方式是：

```text
业务系统
  ↓
你自己的 API 网关 / 权限层
  ↓
OpenClaw Gateway /v1/responses
```

原因是：在 shared-secret 模式下，`Authorization: Bearer <gateway secret>`
等价于非常高权限的 operator 访问，而不是一个普通“只会聊天”的 API
key。这个判断来自 OpenClaw 文档对 shared-secret 模式 full operator scope
的说明。([OpenClaw][1])

---

## 4. OpenClaw 的 agent 选择方式

OpenClaw 在 Responses 的 `model` 字段上做了 agent routing
扩展。可以用以下方式选择 agent：

```json
{
  "model": "openclaw"
}
```

```json
{
  "model": "openclaw/default"
}
```

```json
{
  "model": "openclaw/<agentId>"
}
```

也可以用 header：

```http
x-openclaw-agent-id: <agentId>
```

如果想覆盖被选中 agent 的后端模型，可以用：

```http
x-openclaw-model: <backend-model>
```

文档明确列出：`model: "openclaw"`、`model: "openclaw/default"`、`model: "openclaw/<agentId>"`
和 `x-openclaw-agent-id` 用于选择 agent；`x-openclaw-model` 用于覆盖 selected
agent 的 backend model。([OpenClaw][1])

### 推荐规则

| 需求                   | 推荐写法                                           |
| ---------------------- | -------------------------------------------------- |
| 用默认 agent           | `model: "openclaw"` 或 `model: "openclaw/default"` |
| 指定 agent             | `model: "openclaw/<agentId>"`                      |
| 由网关层统一指定 agent | `x-openclaw-agent-id: <agentId>`                   |
| 临时覆盖后端模型       | `x-openclaw-model: <model>`                        |

示例：

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-openclaw-agent-id: main' \
  -d '{
    "model": "openclaw",
    "input": "生成一份订单异常分析"
  }'
```

---

## 5. OpenClaw 的 session 行为

这是很重要的 OpenClaw 特有语义：**默认每次请求都是无状态的**，Gateway
会为每次调用生成新的 session key。只有当请求里包含 OpenResponses 的 `user`
字符串时，Gateway 才会从 `user` 派生稳定 session key，让重复调用共享同一个 agent
session。([OpenClaw][1])

### 5.1 默认行为：每次新 session

```json
{
  "model": "openclaw",
  "input": "帮我分析这个问题"
}
```

这种情况下，每次请求都是新的 session。

### 5.2 用 `user` 绑定稳定 session

```json
{
  "model": "openclaw",
  "user": "tenant-a:user-123",
  "input": "继续上次任务"
}
```

同一个 agent + 同一个 `user` 可以共享 agent session。文档描述为：如果请求包含
OpenResponses `user` string，Gateway 会从它派生 stable session
key。([OpenClaw][1])

### 5.3 显式指定 session key

OpenClaw 还提供 header：

```http
x-openclaw-session-key: <session-key>
```

用于 explicit session routing。([OpenClaw][1])

### 5.4 `previous_response_id`

OpenClaw 支持：

```json
{
  "previous_response_id": "resp_..."
}
```

但它的行为是 OpenClaw 特化的：当请求保持在同一个 agent / user /
requested-session scope 内时，OpenClaw 会复用 earlier response
session。([OpenClaw][1])

### 推荐用法

如果你是业务系统派发任务，建议自己生成稳定的业务 session 标识：

```text
tenant:{tenantId}:task:{taskId}
tenant:{tenantId}:user:{userId}
```

然后放入：

```json
{
  "user": "tenant-a:task-20260424-001"
}
```

或者更明确地使用：

```http
x-openclaw-session-key: tenant-a:task-20260424-001
```

---

## 6. OpenClaw 的 synthetic ingress channel

OpenClaw 提供一个专有 header：

```http
x-openclaw-message-channel: <channel>
```

用于指定 non-default synthetic ingress channel context。([OpenClaw][1])

这个字段不是标准 Responses API 的核心字段，而是 OpenClaw 把 HTTP
请求接入自身多渠道消息体系时使用的上下文标记。

可以理解为：

```text
HTTP /v1/responses 请求
  ↓
被包装成一个来自某个“合成渠道”的 OpenClaw message
  ↓
进入 Gateway agent run
```

适合你想区分来源时使用，例如：

```http
x-openclaw-message-channel: ecommerce_backend
```

或者：

```http
x-openclaw-message-channel: internal_task_dispatcher
```

---

## 7. OpenClaw 对 request 字段的当前支持边界

OpenClaw 文档列出的当前支持字段包括：

```text
input
instructions
tools
tool_choice
stream
max_output_tokens
user
previous_response_id
```

其中 `max_output_tokens` 是 best-effort，依赖底层 provider。([OpenClaw][1])

OpenClaw 接受但当前忽略这些字段：

```text
max_tool_calls
reasoning
metadata
store
truncation
```

`reasoning` 和 `item_reference` item 也会为了 schema compatibility
被接受，但在构建 prompt 时会被忽略。([OpenClaw][1])

### 对接时的含义

不要依赖这些字段产生实际效果：

```json
{
  "reasoning": { "effort": "high" },
  "metadata": { "task_id": "abc" },
  "store": true,
  "truncation": "auto"
}
```

在 OpenClaw
当前实现里，它们更像“兼容接受但不执行”的字段。业务元数据建议你自己在业务系统里存储；需要传给
agent 的元信息，应放进 `instructions` 或 `input`，或者用你自己的 session/task
mapping 管理。

---

## 8. OpenClaw 的 input item 处理规则

OpenClaw 对 `message` item 有自己的 prompt 构造规则：

| item 角色                      | OpenClaw 行为        |
| ------------------------------ | -------------------- |
| `system`                       | 追加到 system prompt |
| `developer`                    | 追加到 system prompt |
| 最近的 `user`                  | 成为 current message |
| 最近的 `function_call_output`  | 成为 current message |
| 更早的 user/assistant messages | 作为 history context |

文档说明：`system` 和 `developer` 会 appended to the system prompt；最近的
`user` 或 `function_call_output` item 会成为 current message；更早的
user/assistant messages 会被作为 history for context。([OpenClaw][1])

### 实现建议

如果你要稳定地产生结构化输出，不要只把 JSON schema
放在普通历史消息里。更建议放进 `instructions`，因为 OpenClaw 会把 `instructions`
合并进 system prompt。([OpenClaw][1])

例如：

```json
{
  "model": "openclaw/main",
  "instructions": "你必须只返回合法 JSON，不要 Markdown。返回结构：{\"status\":\"success|failed\",\"data\":{},\"errors\":[]}",
  "input": "分析这份日报并返回结构化结果。"
}
```

---

## 9. OpenClaw 的 client-side function tools 回合模型

OpenClaw 支持 client-side function tools。调用方在 `tools` 里提供函数定义；如果
agent 决定调用工具，response 会返回 `function_call` output
item。然后调用方需要发 follow-up request，带 `function_call_output` 继续这个
turn。([OpenClaw][1])

OpenClaw 的 tool result item 示例：

```json
{
  "type": "function_call_output",
  "call_id": "call_123",
  "output": "{\"temperature\": \"72F\"}"
}
```

这适合业务系统把内部能力保留在自己一侧：

```text
OpenClaw agent：我要调用 query_order(order_id)
你的服务：执行真实订单系统查询
你的服务：把 function_call_output 发回 /v1/responses
OpenClaw agent：基于结果继续推理并输出最终 JSON
```

---

## 10. OpenClaw 的文件输入处理：重点是安全与临时性

OpenClaw 支持 `input_file`，但其处理方式有几个特殊点。

### 10.1 支持的文件类型和大小

当前支持 MIME：

```text
text/plain
text/markdown
text/html
text/csv
application/json
application/pdf
```

默认单文件最大 5MB。([OpenClaw][1])

### 10.2 文件不会作为普通用户消息持久化

文档说明：文件内容会被解码后加入 system prompt，而不是 user message，因此它是
ephemeral，不会持久化到 session history。([OpenClaw][1])

这点对任务系统很重要：如果你用同一个 session
连续调用，前一次上传文件内容不会作为普通会话历史长期存在。需要长期复用的文件内容，应由你的业务系统保存并在后续请求中重新提供，或让
agent 产出摘要后保存。

### 10.3 文件会被标记为不可信外部内容

OpenClaw 会把解码后的文件文本包成 untrusted external content，再加入
prompt。注入块包含显式边界标记：

```text
<<<EXTERNAL_UNTRUSTED_CONTENT id="...">>>
...
<<<END_EXTERNAL_UNTRUSTED_CONTENT id="...">>>
```

并包含：

```text
Source: External
```

文档说明这是为了把文件字节当作数据，而不是可信指令。([OpenClaw][1])

### 10.4 PDF 处理

PDF 会先尝试文本解析；如果解析出的文本太少，OpenClaw 会把前几页 rasterize
成图片交给模型，并在注入的 file block 里使用占位：

```text
[PDF content rendered to images]
```

文档还说明 PDF 解析使用 Node-friendly 的 `pdfjs-dist` legacy build，不使用需要
browser workers / DOM globals 的现代 PDF.js build。([OpenClaw][1])

---

## 11. OpenClaw 的图片输入处理

OpenClaw 支持 `input_image`，source 可以是 base64 或 URL。当前支持：

```text
image/jpeg
image/png
image/gif
image/webp
image/heic
image/heif
```

默认最大 10MB。HEIC/HEIF 会在 provider delivery 前 normalized to
JPEG。([OpenClaw][1])

---

## 12. URL 输入的安全策略

OpenClaw 支持 URL-based `input_file` 和 `input_image`，默认：

```text
files.allowUrl: true
images.allowUrl: true
maxUrlParts: 8
```

`maxUrlParts` 是一个请求中 URL-based `input_file` + `input_image`
的总数上限。URL 请求会经过 DNS resolution、private IP blocking、redirect
caps、timeouts 等防护。([OpenClaw][1])

OpenClaw 还支持按输入类型配置 hostname allowlist：

```ts
files: {
  urlAllowlist: ["cdn.example.com", "*.assets.example.com"];
}

images: {
  urlAllowlist: ["images.example.com"];
}
```

文档说明 exact host 如 `"cdn.example.com"`，wildcard subdomains 如
`"*.assets.example.com"`，且 wildcard 不匹配 apex；空或省略 allowlist 表示不做
hostname allowlist 限制。([OpenClaw][1])

安全注意：hostname allowlist 不会绕过 private/internal IP blocking；对于
internet-exposed gateways，文档建议除了 app-level guards 外还要使用网络 egress
controls。([OpenClaw][1])

---

## 13. OpenClaw 可调限制项

OpenClaw 的 Responses endpoint 限制项可在：

```text
gateway.http.endpoints.responses
```

下配置。核心默认值如下：([OpenClaw][1])

| 配置                     |    默认值 |
| ------------------------ | --------: |
| `maxBodyBytes`           |      20MB |
| `maxUrlParts`            |         8 |
| `files.maxBytes`         |       5MB |
| `files.maxChars`         |      200k |
| `files.maxRedirects`     |         3 |
| `files.timeoutMs`        |       10s |
| `files.pdf.maxPages`     |         4 |
| `files.pdf.maxPixels`    | 4,000,000 |
| `files.pdf.minTextChars` |       200 |
| `images.maxBytes`        |      10MB |
| `images.maxRedirects`    |         3 |
| `images.timeoutMs`       |       10s |

示例配置：

```ts
{
  gateway: {
    http: {
      endpoints: {
        responses: {
          enabled: true,
          maxBodyBytes: 20000000,
          maxUrlParts: 8,
          files: {
            allowUrl: true,
            urlAllowlist: ["cdn.example.com", "*.assets.example.com"],
            allowedMimes: [
              "text/plain",
              "text/markdown",
              "text/html",
              "text/csv",
              "application/json",
              "application/pdf"
            ],
            maxBytes: 5242880,
            maxChars: 200000,
            maxRedirects: 3,
            timeoutMs: 10000,
            pdf: {
              maxPages: 4,
              maxPixels: 4000000,
              minTextChars: 200
            }
          },
          images: {
            allowUrl: true,
            urlAllowlist: ["images.example.com"],
            allowedMimes: [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp",
              "image/heic",
              "image/heif"
            ],
            maxBytes: 10485760,
            maxRedirects: 3,
            timeoutMs: 10000
          }
        }
      }
    }
  }
}
```

---

## 14. OpenClaw 的 streaming 事件集合

标准 SSE 格式不展开，这里只列 OpenClaw 当前会 emit 的 event type：

```text
response.created
response.in_progress
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
response.failed
```

文档说明 stream 结束时会发送：

```text
data: [DONE]
```

([OpenClaw][1])

对业务系统来说，最重要的是：

| 事件                         | 建议用途         |
| ---------------------------- | ---------------- |
| `response.output_text.delta` | 展示增量文本     |
| `response.completed`         | 标记任务成功完成 |
| `response.failed`            | 标记任务失败     |
| `[DONE]`                     | 关闭流读取       |

如果你需要“任务最终结构化结果”，可以忽略中间 delta，只在 `response.completed`
后聚合完整输出并做 JSON 校验。

---

## 15. OpenClaw 的 usage 归一化

OpenClaw 会在底层 provider 报告 token counts 时填充
`usage`。它还会在这些计数进入 downstream status/session surfaces 前，归一化常见
OpenAI-style alias，包括：

```text
input_tokens / output_tokens
prompt_tokens / completion_tokens
```

([OpenClaw][1])

对接时建议同时兼容这两组命名，或者在你自己的服务层统一转成一种内部格式。

---

## 16. 错误格式和常见 HTTP 状态

OpenClaw 的错误体形如：

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error"
  }
}
```

常见状态码：

```text
401 missing/invalid auth
400 invalid request body
405 wrong method
```

([OpenClaw][1])

建议你的调用层至少区分：

| HTTP 状态        | 处理                      |
| ---------------- | ------------------------- |
| `400`            | 请求构造错误，不自动重试  |
| `401`            | token/auth 配置错误，报警 |
| `405`            | endpoint/method 写错      |
| `5xx` 或网络错误 | 可带幂等 task id 重试     |

---

## 17. 面向“派发任务 + 结构化输出”的推荐调用模板

### 17.1 同步任务

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-openclaw-agent-id: task-agent' \
  -H 'x-openclaw-message-channel: internal_task_dispatcher' \
  -d '{
    "model": "openclaw",
    "user": "tenant-a:task-20260424-001",
    "instructions": "你是任务执行器。必须只返回合法 JSON，不要 Markdown，不要解释。JSON schema: {\"status\":\"success|failed\",\"summary\":\"string\",\"data\":\"object\",\"errors\":\"array\"}",
    "input": "请分析订单异常并返回结构化结果。"
  }'
```

### 17.2 流式任务

```bash
curl -N http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-openclaw-agent-id: task-agent' \
  -H 'x-openclaw-message-channel: internal_task_dispatcher' \
  -d '{
    "model": "openclaw",
    "stream": true,
    "user": "tenant-a:task-20260424-001",
    "instructions": "最终必须输出合法 JSON。",
    "input": "执行这项长任务，并在结束时给出结构化结果。"
  }'
```

### 17.3 带显式 session key

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-openclaw-agent-id: task-agent' \
  -H 'x-openclaw-session-key: tenant-a:workflow-7788' \
  -d '{
    "model": "openclaw",
    "input": "继续处理 workflow-7788 的下一步。"
  }'
```

---

## 18. 对接注意事项

### 18.1 结构化输出不要假设有原生 JSON schema enforcement

这页文档没有列出 `response_format` 或 JSON schema enforcement 相关能力；它列出的
supported request fields 只有
`input`、`instructions`、`tools`、`tool_choice`、`stream`、`max_output_tokens`、`user`，以及
`previous_response_id`。([OpenClaw][1])

所以建议：

```text
instructions 强约束 JSON
↓
业务侧 JSON.parse
↓
AJV / Zod / Pydantic 校验
↓
不合法则带错误信息重试一次
```

### 18.2 不要把业务 metadata 只放在 `metadata`

OpenClaw 当前接受但忽略 `metadata`。如果 metadata 需要影响模型行为，放进
`instructions` 或
`input`；如果只是业务追踪，放在你自己的数据库或任务表里。([OpenClaw][1])

### 18.3 文件是 ephemeral，不要依赖 session 记住原文件

OpenClaw 会把文件内容作为不可信外部内容注入 system prompt，且不作为 user message
持久化到 session
history。后续请求如果还需要文件上下文，应该重新提供文件，或者先让 agent
生成可持久化摘要。([OpenClaw][1])

### 18.4 对公网 Gateway 要格外小心 URL fetch

URL-based file/image fetch 默认可用，但有 private IP blocking、redirect
caps、timeouts 和 allowlist 支持。对于 internet-exposed Gateway，OpenClaw
文档建议配合网络 egress controls。([OpenClaw][1])

---

## 19. 最简心智模型

```text
OpenClaw OpenResponses API =
  OpenAI Responses 风格 HTTP 外壳
  + OpenClaw Gateway agent run
  + OpenClaw agent routing
  + OpenClaw Gateway auth/scope 语义
  + OpenClaw session routing
  + OpenClaw 文件/图片安全注入
  + OpenClaw URL fetch 防护
```

对你的场景，“发 message → 指定任务 → 获取结构化结果”，建议把它当成：

```text
OpenClaw 的 HTTP 任务派发入口
```

而不是完整 Gateway
控制面。完整控制面、节点、pairing、approval、presence、session
原生事件，仍然属于 Gateway WebSocket 协议的范围。

[1]: https://docs.openclaw.ai/gateway/openresponses-http-api "OpenResponses API - OpenClaw"
[2]: https://docs.openclaw.ai/gateway/protocol "Gateway Protocol - OpenClaw"
