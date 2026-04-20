# API 参考

所有 API 端点均基于 Next.js App Router，无需认证。

## 任务管理 `/api/tasks`

### 列出任务

```
GET /api/tasks?workspaceId={id}&status={status}&limit={n}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| status | TaskStatus | ❌ | 状态筛选 |
| limit | number | ❌ | 数量限制（默认 50，最大 200） |

**响应 200：**
```json
{
  "tasks": [{ "id": "...", "title": "...", "status": "Ready", ... }],
  "count": 15
}
```

### 创建任务

```
POST /api/tasks
Content-Type: application/json
```

**请求体：**
```json
{
  "workspaceId": "default",
  "title": "分析用户行为数据",
  "description": "使用 Python 分析最近30天数据",
  "priority": "High",
  "dueAt": "2025-01-20T00:00:00Z",
  "runtimeAdapterKey": "openclaw",
  "runtimeModel": "gpt-4o",
  "prompt": "分析用户行为数据并生成报告"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workspaceId | string | ✅ | 工作空间 ID |
| title | string | ✅ | 任务标题 |
| description | string | ❌ | 描述 |
| priority | TaskPriority | ❌ | Low/Medium/High/Urgent |
| dueAt | ISO DateTime | ❌ | 截止时间 |
| runtimeAdapterKey | string | ❌ | 运行时适配器 (如 "openclaw") |
| runtimeInput | string | ❌ | 运行时输入 (JSON) |
| runtimeInputVersion | string | ❌ | 输入版本 |
| runtimeModel | string | ❌ | AI 模型名称 |
| prompt | string | ❌ | 执行提示词 |
| runtimeConfig | string | ❌ | 额外配置 (JSON) |

**响应 201：**
```json
{ "taskId": "cm...", ... }
```

### 获取任务详情

```
GET /api/tasks/{taskId}
```

**响应 200：**
```json
{
  "task": {
    "id": "cm...",
    "title": "...",
    "status": "Running",
    "projection": { "displayState": "Running", ... },
    "runs": [{ "id": "...", "status": "Running", ... }]
  }
}
```

### 更新任务

```
PATCH /api/tasks/{taskId}
Content-Type: application/json
```

**请求体：** 与创建相同的字段，均为可选。支持部分更新。

**响应 200：** 更新后的任务。

### 删除任务

```
DELETE /api/tasks/{taskId}
```

**行为：** 级联删除所有关联数据（执行、会话、审批、产出物、事件、投影等）。

**响应 200：**
```json
{ "success": true, "taskId": "cm..." }
```

---

## 任务操作

### 启动执行

```
POST /api/tasks/{taskId}/run
```

**请求体：**
```json
{ "prompt": "可选的覆盖 prompt" }
```

**响应 201：** 执行结果。

**前提条件：** 任务必须可运行（有 runtimeAdapterKey 和 prompt）。

### 标记完成

```
POST /api/tasks/{taskId}/done
```

### 重新打开

```
POST /api/tasks/{taskId}/reopen
```

### 发送消息

```
POST /api/tasks/{taskId}/message
```

**请求体：**
```json
{
  "message": "请增加数据可视化部分",
  "runId": "可选，不提供则自动选择最新活跃执行"
}
```

### 提供输入

```
POST /api/tasks/{taskId}/input
```

**请求体：**
```json
{
  "inputText": "用户输入的内容",
  "runId": "可选"
}
```

### 生成计划

```
POST /api/tasks/{taskId}/plan
```

**响应：** 生成的执行计划。

### 应用排期

```
POST /api/tasks/{taskId}/schedule
```

**请求体：**
```json
{
  "scheduledStartAt": "2025-01-15T14:00:00Z",
  "scheduledEndAt": "2025-01-15T15:00:00Z",
  "dueAt": "2025-01-20T00:00:00Z",
  "scheduleSource": "human"
}
```

### 清除排期

```
DELETE /api/tasks/{taskId}/schedule
```

### 列出子任务

```
GET /api/tasks/{taskId}/subtasks
```

**响应 200：**
```json
{ "subtasks": [...], "count": 3 }
```

### 创建子任务

```
POST /api/tasks/{taskId}/subtasks
```

**请求体：**
```json
{
  "title": "子任务标题",
  "description": "描述",
  "priority": "Medium",
  "dueAt": "2025-01-18T00:00:00Z"
}
```

---

## AI 智能端点 `/api/ai`

### 任务分解

```
POST /api/ai/decompose-task
```

**请求体（两种模式）：**

```json
// 模式1：基于已有任务
{ "taskId": "cm..." }

// 模式2：基于临时数据
{
  "title": "准备季度报告",
  "description": "包含销售、运营、财务数据",
  "priority": "High",
  "estimatedMinutes": 120
}
```

**响应 200：**
```json
{
  "subtasks": [
    { "title": "收集销售数据", "estimatedMinutes": 30, "priority": "High" },
    { "title": "编写运营分析", "estimatedMinutes": 45, "priority": "Medium" }
  ],
  "totalEstimatedMinutes": 120,
  "feasibilityScore": 0.85
}
```

### 批量分解（分解 + 创建）

```
POST /api/ai/batch-decompose
```

**请求体：**
```json
{ "taskId": "cm..." }
```

**响应 201：**
```json
{
  "parentTaskId": "cm...",
  "subtasks": [{ "id": "cm...", "title": "..." }],
  "decomposition": {
    "totalEstimatedMinutes": 120,
    "feasibilityScore": 0.85,
    "warnings": []
  }
}
```

### 自动补全

```
POST /api/ai/auto-complete
```

**请求体：**
```json
{
  "title": "分析",
  "workspaceId": "default"
}
```

**响应 200：**
```json
{
  "suggestions": [
    {
      "title": "分析用户行为数据",
      "description": "使用数据分析工具处理用户行为日志",
      "priority": "Medium",
      "estimatedMinutes": 60
    }
  ],
  "source": "openclaw"
}
```

**优先级链：** OpenClaw CLI Bridge → 直接 LLM → 中文关键词规则引擎

### 自动化建议

```
POST /api/ai/suggest-automation
```

**请求体：**
```json
{ "taskId": "cm..." }
```

### 时间段建议

```
POST /api/ai/suggest-timeslot
```

**请求体：**
```json
{
  "workspaceId": "default",
  "taskId": "cm...",
  "date": "2025-01-15"
}
```

### 冲突分析

```
POST /api/ai/analyze-conflicts
```

**请求体：**
```json
{
  "workspaceId": "default",
  "date": "2025-01-15"
}
```

**响应 200：**
```json
{
  "conflicts": [
    {
      "type": "time_overlap",
      "severity": "high",
      "description": "任务 A 和任务 B 在 14:00-15:00 时间重叠",
      "involvedTaskIds": ["cm1...", "cm2..."]
    }
  ],
  "suggestions": [
    {
      "type": "reschedule",
      "description": "将任务 B 移至 15:00-16:00",
      "changes": [...]
    }
  ]
}
```

### 应用建议

```
POST /api/ai/apply-suggestion
```

**请求体：**
```json
{
  "workspaceId": "default",
  "suggestionId": "sug_...",
  "changes": [
    {
      "taskId": "cm...",
      "field": "scheduledStartAt",
      "value": "2025-01-15T15:00:00Z"
    }
  ]
}
```

### 工具调用（OpenClaw 插件用）

```
POST /api/ai/suggest-tool-call
```

**请求体：**
```json
{
  "tool_name": "schedule.list_tasks",
  "arguments": { "workspace_id": "default" },
  "request_id": "req_123"
}
```

**可用工具：**
- `schedule.list_tasks` — 列出任务
- `schedule.get_health` — 获取排期健康
- `schedule.check_conflicts` — 检查冲突

---

## 投影/页面数据 `/api/{page}/projection`

### 排期投影

```
GET /api/schedule/projection?workspaceId={id}
```

返回 `SchedulePageData`（参见 [模块文档 - getSchedulePage](./modules.md#getschedulepageworkspaceid-selectedday)）。

### 工作台投影

```
GET /api/work/{taskId}/projection
```

返回 `WorkPageData`。

### 收件箱投影

```
GET /api/inbox/projection?workspaceId={id}
```

### 记忆投影

```
GET /api/memory/projection?workspaceId={id}
```

---

## 错误处理

所有 API 返回标准错误格式：

```json
{
  "error": "错误描述",
  "code": "ERROR_CODE"
}
```

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数无效 |
| 404 | 资源不存在 |
| 409 | 状态冲突（如任务已完成不能再次标记完成） |
| 500 | 服务器内部错误 |
