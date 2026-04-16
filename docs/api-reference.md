# API 参考文档

AgentDashboard 完整 REST API 参考。所有端点返回 JSON 格式，错误响应统一为 `{ "error": "错误描述" }`。

基础 URL: `http://localhost:3000`

---

## 目录

- [任务管理](#任务管理)
  - [GET /api/tasks — 列出任务](#get-apitasks)
  - [POST /api/tasks — 创建任务](#post-apitasks)
  - [GET /api/tasks/:taskId — 获取任务详情](#get-apitaskstaskid)
  - [PATCH /api/tasks/:taskId — 更新任务](#patch-apitaskstaskid)
  - [DELETE /api/tasks/:taskId — 删除任务](#delete-apitaskstaskid)
- [任务操作](#任务操作)
  - [POST /api/tasks/:taskId/run — 启动运行](#post-apitaskstaskidrun)
  - [POST /api/tasks/:taskId/schedule — 设置排程](#post-apitaskstaskidschedule)
  - [DELETE /api/tasks/:taskId/schedule — 清除排程](#delete-apitaskstaskidschedule)
  - [POST /api/tasks/:taskId/done — 标记完成](#post-apitaskstaskiddone)
  - [POST /api/tasks/:taskId/reopen — 重新打开](#post-apitaskstaskidreopen)
  - [POST /api/tasks/:taskId/message — 发送消息](#post-apitaskstaskidmessage)
  - [POST /api/tasks/:taskId/input — 提供输入](#post-apitaskstaskinput)
  - [POST /api/tasks/:taskId/plan — 生成计划](#post-apitaskstaskidplan)
- [子任务](#子任务)
  - [GET /api/tasks/:taskId/subtasks — 列出子任务](#get-apitaskstaskidsubtasks)
  - [POST /api/tasks/:taskId/subtasks — 创建子任务](#post-apitaskstaskidsubtasks)
- [投影查询](#投影查询)
  - [GET /api/schedule/projection — 排程投影](#get-apischeduleprojection)
  - [GET /api/inbox/projection — 收件箱投影](#get-apiinboxprojection)
  - [GET /api/memory/projection — 记忆投影](#get-apimemoryprojection)
  - [GET /api/work/:taskId/projection — 工作页投影](#get-apiworktaskidprojection)
- [AI 能力](#ai-能力)
  - [POST /api/ai/analyze-conflicts — 冲突分析](#post-apiaianalyze-conflicts)
  - [POST /api/ai/apply-suggestion — 应用建议](#post-apiaiapply-suggestion)
  - [POST /api/ai/auto-complete — 自动补全](#post-apiaiauto-complete)
  - [POST /api/ai/batch-decompose — 批量分解](#post-apiaibatch-decompose)
  - [POST /api/ai/decompose-task — 任务分解](#post-apiaidecompose-task)
  - [POST /api/ai/suggest-automation — 自动化建议](#post-apiaisuggest-automation)
  - [POST /api/ai/suggest-timeslot — 时间槽建议](#post-apiaisuggest-timeslot)

---

## 任务管理

### GET /api/tasks

列出工作空间中的任务。

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| status | string | ❌ | 按状态筛选。有效值: `Pending`, `Running`, `WaitingForApproval`, `WaitingForInput`, `Done`, `Failed`, `Cancelled` |
| limit | number | ❌ | 返回数量上限，默认 50，最大 200 |

**响应 (200):**

```json
{
  "tasks": [
    {
      "id": "task_abc123",
      "workspaceId": "ws_001",
      "title": "任务标题",
      "description": "任务描述",
      "status": "Pending",
      "priority": "Medium",
      "dueAt": "2025-12-31T00:00:00.000Z",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "projection": { ... }
    }
  ],
  "count": 1
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId 或状态值无效 |
| 500 | 服务端错误 |

**示例:**

```bash
# 列出所有任务
curl 'http://localhost:3000/api/tasks?workspaceId=ws_001'

# 按状态筛选
curl 'http://localhost:3000/api/tasks?workspaceId=ws_001&status=Running&limit=10'
```

---

### POST /api/tasks

创建新任务。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| title | string | ✅ | 任务标题 |
| description | string | ❌ | 任务描述 |
| priority | string | ❌ | 优先级: `Low`, `Medium`, `High`, `Urgent` |
| dueAt | string (ISO) | ❌ | 截止时间 |
| runtimeAdapterKey | string | ❌ | 运行时适配器键名 |
| runtimeInput | string | ❌ | 运行时输入 |
| runtimeInputVersion | string | ❌ | 运行时输入版本 |
| runtimeModel | string | ❌ | 运行时模型 |
| prompt | string | ❌ | AI 提示词 |
| runtimeConfig | object | ❌ | 运行时配置 |

**响应 (201):**

```json
{
  "taskId": "task_abc123",
  "status": "Pending"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId 或 title |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": "ws_001",
    "title": "编写 API 文档",
    "description": "为所有端点编写完整文档",
    "priority": "High"
  }'
```

---

### GET /api/tasks/:taskId

获取单个任务详情，包含投影和最近 5 次运行记录。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**响应 (200):**

```json
{
  "task": {
    "id": "task_abc123",
    "title": "任务标题",
    "status": "Running",
    "projection": { ... },
    "runs": [
      {
        "id": "run_001",
        "status": "Running",
        "startedAt": "2025-01-01T10:00:00.000Z"
      }
    ]
  }
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl http://localhost:3000/api/tasks/task_abc123
```

---

### PATCH /api/tasks/:taskId

更新任务属性。只传需要修改的字段。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体 (均为可选):**

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 任务标题 |
| description | string | 任务描述 |
| priority | string | 优先级 |
| dueAt | string/null | 截止时间，传 null 清除 |
| scheduledStartAt | string/null | 排程开始时间 |
| scheduledEndAt | string/null | 排程结束时间 |
| runtimeAdapterKey | string | 运行时适配器 |
| runtimeInput | string | 运行时输入 |
| runtimeInputVersion | string | 输入版本 |
| runtimeModel | string | 模型 |
| prompt | string | 提示词 |
| runtimeConfig | object | 运行时配置 |

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "status": "Pending"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X PATCH http://localhost:3000/api/tasks/task_abc123 \
  -H 'Content-Type: application/json' \
  -d '{"priority": "Urgent", "dueAt": "2025-06-30T23:59:59Z"}'
```

---

### DELETE /api/tasks/:taskId

删除任务及其所有关联记录（运行记录、事件、子任务等）。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**响应 (200):**

```json
{
  "success": true,
  "taskId": "task_abc123"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X DELETE http://localhost:3000/api/tasks/task_abc123
```

---

## 任务操作

### POST /api/tasks/:taskId/run

为任务启动一个新的 AI 代理运行。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体 (可选):**

| 字段 | 类型 | 说明 |
|------|------|------|
| prompt | string | 运行提示词覆盖 |

**响应 (201):**

```json
{
  "runId": "run_001",
  "taskId": "task_abc123",
  "status": "Running"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 启动运行失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/run \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "请用 TypeScript 实现"}'
```

---

### POST /api/tasks/:taskId/schedule

为任务设置排程时间段。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| scheduledStartAt | string (ISO) | ✅ | 排程开始时间 |
| scheduledEndAt | string (ISO) | ✅ | 排程结束时间 |
| dueAt | string (ISO) | ❌ | 截止时间 |
| scheduleSource | string | ❌ | 排程来源，默认 `"system"` |

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "scheduledStartAt": "2025-01-15T09:00:00.000Z",
  "scheduledEndAt": "2025-01-15T11:00:00.000Z"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 scheduledStartAt 或 scheduledEndAt |
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/schedule \
  -H 'Content-Type: application/json' \
  -d '{
    "scheduledStartAt": "2025-01-15T09:00:00Z",
    "scheduledEndAt": "2025-01-15T11:00:00Z"
  }'
```

---

### DELETE /api/tasks/:taskId/schedule

清除任务的排程。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "scheduledStartAt": null,
  "scheduledEndAt": null
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X DELETE http://localhost:3000/api/tasks/task_abc123/schedule
```

---

### POST /api/tasks/:taskId/done

将任务标记为完成。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:** 无

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "status": "Done"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 状态转换无效 |
| 404 | 任务不存在 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/done
```

---

### POST /api/tasks/:taskId/reopen

重新打开已完成的任务。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:** 无

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "status": "Pending"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/reopen
```

---

### POST /api/tasks/:taskId/message

向正在运行的 AI 代理发送操作员消息。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | ✅ | 消息内容 |
| runId | string | ❌ | 指定运行 ID，不传则自动使用最新活跃运行 |

**响应 (200):**

```json
{
  "success": true,
  "runId": "run_001"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 消息为空或没有活跃运行 |
| 404 | 运行不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "请优先处理数据库迁移部分"}'
```

---

### POST /api/tasks/:taskId/input

向等待输入的 AI 代理提供输入。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inputText | string | ✅ | 输入文本 |
| runId | string | ❌ | 指定运行 ID，不传则自动使用最新等待输入的运行 |

**响应 (200):**

```json
{
  "success": true,
  "runId": "run_001"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 输入为空或没有等待输入的运行 |
| 404 | 运行不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/input \
  -H 'Content-Type: application/json' \
  -d '{"inputText": "使用 PostgreSQL 作为数据库"}'
```

---

### POST /api/tasks/:taskId/plan

为任务生成或更新执行计划。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**请求体:** 无

**响应 (200):**

```json
{
  "taskId": "task_abc123",
  "plan": { ... }
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |
| 500 | 生成计划失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/plan
```

---

## 子任务

### GET /api/tasks/:taskId/subtasks

列出某个父任务的所有子任务。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 父任务 ID |

**响应 (200):**

```json
{
  "subtasks": [
    {
      "id": "task_sub001",
      "title": "子任务 1",
      "status": "Pending",
      "parentTaskId": "task_abc123",
      "projection": { ... }
    }
  ],
  "count": 1
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 父任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl http://localhost:3000/api/tasks/task_abc123/subtasks
```

---

### POST /api/tasks/:taskId/subtasks

在父任务下创建子任务。子任务自动继承父任务的 workspaceId。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 父任务 ID |

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 子任务标题 |
| description | string | ❌ | 描述 |
| priority | string | ❌ | 优先级 |
| dueAt | string (ISO) | ❌ | 截止时间 |

**响应 (201):**

```json
{
  "subtask": {
    "id": "task_sub001",
    "title": "子任务标题",
    "parentTaskId": "task_abc123",
    "projection": { ... }
  }
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 title |
| 404 | 父任务不存在 |
| 500 | 服务端错误 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/tasks/task_abc123/subtasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "实现用户认证模块", "priority": "High"}'
```

---

## 投影查询

### GET /api/schedule/projection

获取排程页面所需的投影数据。

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |

**响应 (200):** 排程页面聚合数据（任务列表、时间线信息等）

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId |

**示例:**

```bash
curl 'http://localhost:3000/api/schedule/projection?workspaceId=ws_001'
```

---

### GET /api/inbox/projection

获取收件箱页面所需的投影数据（需要人工干预的任务）。

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |

**响应 (200):** 收件箱聚合数据（待审批、待输入等任务）

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId |

**示例:**

```bash
curl 'http://localhost:3000/api/inbox/projection?workspaceId=ws_001'
```

---

### GET /api/memory/projection

获取记忆管理页面的投影数据。

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |

**响应 (200):** 记忆条目聚合数据

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId |

**示例:**

```bash
curl 'http://localhost:3000/api/memory/projection?workspaceId=ws_001'
```

---

### GET /api/work/:taskId/projection

获取工作执行页面的投影数据。

**路径参数:**

| 参数 | 说明 |
|------|------|
| taskId | 任务 ID |

**响应 (200):** 任务工作页聚合数据（任务详情、运行状态、会话历史等）

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 404 | 任务不存在 |

**示例:**

```bash
curl http://localhost:3000/api/work/task_abc123/projection
```

---

## AI 能力

### POST /api/ai/analyze-conflicts

分析排程冲突。分析指定日期或未来 7 天内的时间冲突和依赖冲突。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| date | string (ISO) | ❌ | 分析日期，不传则分析未来 7 天 |

**响应 (200):**

```json
{
  "conflicts": [
    {
      "type": "overlap",
      "taskIds": ["task_001", "task_002"],
      "description": "两个任务在 9:00-10:00 存在时间重叠",
      "severity": "high"
    }
  ],
  "suggestions": [ ... ]
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId |
| 500 | 分析失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/analyze-conflicts \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId": "ws_001", "date": "2025-01-15"}'
```

---

### POST /api/ai/apply-suggestion

应用 AI 建议的排程调整，批量更新多个任务的排程时间。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| suggestionId | string | ✅ | 建议 ID |
| changes | TaskChange[] | ✅ | 变更列表 |

`TaskChange` 结构:

| 字段 | 类型 | 说明 |
|------|------|------|
| taskId | string | 任务 ID |
| scheduledStartAt | string (ISO) | 新开始时间 |
| scheduledEndAt | string (ISO) | 新结束时间 |

**响应 (200):**

```json
{
  "success": true,
  "appliedChanges": 3,
  "suggestionId": "sug_001"
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少必填字段 |
| 403 | 部分任务不属于该工作空间 |
| 500 | 应用失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/apply-suggestion \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": "ws_001",
    "suggestionId": "sug_001",
    "changes": [
      {"taskId": "task_001", "scheduledStartAt": "2025-01-15T10:00:00Z", "scheduledEndAt": "2025-01-15T11:00:00Z"},
      {"taskId": "task_002", "scheduledStartAt": "2025-01-15T11:00:00Z", "scheduledEndAt": "2025-01-15T12:00:00Z"}
    ]
  }'
```

---

### POST /api/ai/auto-complete

根据任务标题自动补全任务信息。优先使用 LLM，降级到关键词规则匹配。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 任务标题（部分输入） |
| workspaceId | string | ❌ | 工作空间 ID（可提高建议质量） |

**响应 (200):**

```json
{
  "suggestions": [
    {
      "title": "编写 API 文档",
      "description": "为所有端点编写完整文档",
      "priority": "Medium",
      "estimatedMinutes": 60,
      "tags": ["writing", "documentation"]
    }
  ]
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | title 为空 |
| 500 | 生成建议失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/auto-complete \
  -H 'Content-Type: application/json' \
  -d '{"title": "review", "workspaceId": "ws_001"}'
```

---

### POST /api/ai/batch-decompose

将任务分解为子任务并自动创建。调用 AI 分解后直接写入数据库。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskId | string | ✅ | 待分解的任务 ID |

**响应 (201):**

```json
{
  "parentTaskId": "task_abc123",
  "subtasks": [
    {
      "id": "task_sub001",
      "title": "子任务 1",
      "parentTaskId": "task_abc123",
      "projection": { ... }
    }
  ],
  "decomposition": {
    "totalEstimatedMinutes": 180,
    "feasibilityScore": 0.85,
    "warnings": []
  }
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 taskId |
| 404 | 任务不存在 |
| 500 | 分解失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/batch-decompose \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "task_abc123"}'
```

---

### POST /api/ai/decompose-task

分解任务为子任务建议（不自动创建）。支持传入 taskId 从数据库查询，或直接传入任务信息。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskId | string | 二选一 | 任务 ID（从数据库查询） |
| title | string | 二选一 | 任务标题（直接传入） |
| description | string | ❌ | 任务描述 |
| priority | string | ❌ | 优先级，默认 `"Medium"` |
| dueAt | string (ISO) | ❌ | 截止时间 |
| estimatedMinutes | number | ❌ | 预估分钟数 |

**响应 (200):**

```json
{
  "subtasks": [
    {
      "title": "子任务 1",
      "description": "描述",
      "priority": "Medium",
      "estimatedMinutes": 30
    }
  ],
  "totalEstimatedMinutes": 90,
  "feasibilityScore": 0.9,
  "warnings": []
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 taskId 和 title |
| 404 | 任务不存在（传 taskId 时） |
| 500 | 分解失败 |

**示例:**

```bash
# 通过 taskId
curl -X POST http://localhost:3000/api/ai/decompose-task \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "task_abc123"}'

# 直接传入信息
curl -X POST http://localhost:3000/api/ai/decompose-task \
  -H 'Content-Type: application/json' \
  -d '{"title": "开发用户系统", "description": "包含注册、登录、权限管理", "priority": "High"}'
```

---

### POST /api/ai/suggest-automation

为任务建议自动化方案。支持传入 taskId 或直接传入任务信息。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskId | string | 二选一 | 任务 ID |
| title | string | 二选一 | 任务标题 |
| description | string | ❌ | 描述 |
| priority | string | ❌ | 优先级 |
| dueAt | string (ISO) | ❌ | 截止时间 |
| scheduledStartAt | string (ISO) | ❌ | 排程开始 |
| scheduledEndAt | string (ISO) | ❌ | 排程结束 |
| isRunnable | boolean | ❌ | 是否可运行 |
| runnabilityState | string | ❌ | 可运行状态 |
| ownerType | string | ❌ | 所有者类型 |

**响应 (200):**

```json
{
  "canAutomate": true,
  "confidence": 0.8,
  "suggestions": [
    {
      "type": "full_automation",
      "description": "此任务可完全自动化执行",
      "steps": ["配置运行时适配器", "设置触发条件"]
    }
  ]
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 taskId 和 title |
| 404 | 任务不存在 |
| 500 | 建议失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/suggest-automation \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "task_abc123"}'
```

---

### POST /api/ai/suggest-timeslot

为任务建议最佳时间槽。基于当前排程寻找空闲时段。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| taskId | string | ✅ | 任务 ID |
| date | string (ISO) | ❌ | 目标日期，默认今天 |

**响应 (200):**

```json
{
  "suggestions": [
    {
      "startAt": "2025-01-15T09:00:00.000Z",
      "endAt": "2025-01-15T10:00:00.000Z",
      "score": 0.95,
      "reason": "该时段空闲且符合优先级"
    }
  ]
}
```

**错误码:**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 workspaceId 或 taskId |
| 404 | 任务不存在 |
| 500 | 建议失败 |

**示例:**

```bash
curl -X POST http://localhost:3000/api/ai/suggest-timeslot \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId": "ws_001", "taskId": "task_abc123", "date": "2025-01-15"}'
```

---

## 通用错误格式

所有端点在出错时返回统一格式：

```json
{
  "error": "错误描述信息"
}
```

常见 HTTP 状态码：

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务端内部错误 |
