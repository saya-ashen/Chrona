# CLI 使用指南

AgentDashboard 提供命令行工具 `agentdash`，支持完整的任务管理、执行控制、排期和 AI 功能。

## 运行方式

```bash
bun src/cli/index.ts [命令组] [子命令] [选项]
```

## 全局选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--base-url <url>` | API 服务地址 | `http://localhost:3000` |
| `-o, --output <format>` | 输出格式 (json/table) | `json` |
| `--help` | 显示帮助信息 | - |

---

## task — 任务管理

### 列出任务

```bash
bun src/cli/index.ts task list -w <workspaceId> [-s <status>] [-l <limit>]
```

| 选项 | 必填 | 说明 |
|------|------|------|
| `-w, --workspace` | ✅ | 工作空间 ID |
| `-s, --status` | ❌ | 筛选状态 (Ready/Running/Failed/...) |
| `-l, --limit` | ❌ | 数量限制 |

**示例：**
```bash
# 列出所有运行中的任务
bun src/cli/index.ts task list -w default -s Running

# 以表格形式显示
bun src/cli/index.ts task list -w default -o table
```

### 获取任务详情

```bash
bun src/cli/index.ts task get -t <taskId>
```

### 创建任务

```bash
bun src/cli/index.ts task create -w <workspaceId> --title <title> [选项]
```

| 选项 | 必填 | 说明 |
|------|------|------|
| `-w, --workspace` | ✅ | 工作空间 ID |
| `--title` | ✅ | 任务标题 |
| `--description` | ❌ | 描述 |
| `--priority` | ❌ | 优先级 (Low/Medium/High/Urgent) |
| `--due` | ❌ | 截止时间 (ISO 格式) |
| `--adapter` | ❌ | 运行时适配器 (如 openclaw) |
| `--model` | ❌ | AI 模型名称 |
| `--prompt` | ❌ | 执行提示词 |

**示例：**
```bash
bun src/cli/index.ts task create -w default \
  --title "代码审查 PR #42" \
  --description "审查新增的认证模块" \
  --priority High \
  --adapter openclaw \
  --model gpt-4o \
  --prompt "请审查 PR #42 的代码变更"
```

### 更新任务

```bash
bun src/cli/index.ts task update -t <taskId> [选项]
```

支持所有创建时的可选字段。

### 标记完成

```bash
bun src/cli/index.ts task done -t <taskId>
```

### 重新打开

```bash
bun src/cli/index.ts task reopen -t <taskId>
```

### 生成计划

```bash
bun src/cli/index.ts task plan -t <taskId>
```

### 删除任务

```bash
bun src/cli/index.ts task delete -t <taskId>
```

### 列出子任务

```bash
bun src/cli/index.ts task subtasks -t <taskId>
```

### 添加子任务

```bash
bun src/cli/index.ts task add-subtask -t <taskId> --title <title> [--description] [--priority]
```

---

## run — 执行控制

### 启动执行

```bash
bun src/cli/index.ts run start -t <taskId> [--prompt <prompt>]
```

**示例：**
```bash
# 使用任务默认 prompt
bun src/cli/index.ts run start -t cm1234567890

# 使用自定义 prompt
bun src/cli/index.ts run start -t cm1234567890 --prompt "只关注安全相关问题"
```

### 发送消息

向运行中的智能体发送消息。

```bash
bun src/cli/index.ts run message -t <taskId> -m <message>
```

**示例：**
```bash
bun src/cli/index.ts run message -t cm1234567890 -m "请加上性能测试结果"
```

### 提供输入

为等待输入的智能体提供回答。

```bash
bun src/cli/index.ts run input -t <taskId> --text <input>
```

**示例：**
```bash
bun src/cli/index.ts run input -t cm1234567890 --text "使用 production 数据库"
```

---

## schedule — 排期管理

### 应用排期

```bash
bun src/cli/index.ts schedule apply -t <taskId> --start <ISO> --end <ISO>
```

**示例：**
```bash
bun src/cli/index.ts schedule apply -t cm1234567890 \
  --start "2025-01-15T14:00:00" \
  --end "2025-01-15T16:00:00"
```

### 清除排期

```bash
bun src/cli/index.ts schedule clear -t <taskId>
```

### 查看排期

```bash
bun src/cli/index.ts schedule view -w <workspaceId>
```

### 冲突分析

```bash
bun src/cli/index.ts schedule conflicts -w <workspaceId> [-d <date>]
```

**示例：**
```bash
bun src/cli/index.ts schedule conflicts -w default -d 2025-01-15
```

### 时间建议

```bash
bun src/cli/index.ts schedule suggest-time -w <workspaceId> -t <taskId> [-d <date>]
```

---

## ai — AI 功能

### 任务分解

```bash
bun src/cli/index.ts ai decompose -t <taskId>
```

### 批量分解（分解 + 创建）

```bash
bun src/cli/index.ts ai batch-decompose -t <taskId>
```

### 自动化建议

```bash
bun src/cli/index.ts ai suggest-automation -t <taskId>
```

### 自动补全

```bash
bun src/cli/index.ts ai auto-complete --title <partial>
```

**示例：**
```bash
bun src/cli/index.ts ai auto-complete --title "分析"
```

### 应用建议

```bash
bun src/cli/index.ts ai apply-suggestion -w <workspaceId> -s <suggestionId> -c <changes-json>
```

---

## 输出格式

### JSON 模式（默认）

```bash
bun src/cli/index.ts task get -t cm1234567890
# 输出原始 JSON
```

### 表格模式

```bash
bun src/cli/index.ts task list -w default -o table
# ┌──────────────┬─────────────────────┬──────────┬──────────┐
# │ ID           │ Title               │ Status   │ Priority │
# ├──────────────┼─────────────────────┼──────────┼──────────┤
# │ cm123...     │ 分析用户数据         │ Running  │ High     │
# └──────────────┴─────────────────────┴──────────┴──────────┘
```

## 典型工作流

### 创建并执行任务

```bash
# 1. 创建任务
bun src/cli/index.ts task create -w default \
  --title "编写技术文档" \
  --adapter openclaw \
  --model gpt-4o \
  --prompt "为项目编写 API 文档"

# 2. 排期
bun src/cli/index.ts schedule apply -t <taskId> \
  --start "2025-01-15T09:00:00" \
  --end "2025-01-15T11:00:00"

# 3. 执行
bun src/cli/index.ts run start -t <taskId>

# 4. 监控（查看详情）
bun src/cli/index.ts task get -t <taskId>

# 5. 与智能体交互
bun src/cli/index.ts run message -t <taskId> -m "补充安全相关内容"

# 6. 完成
bun src/cli/index.ts task done -t <taskId>
```

### AI 辅助规划

```bash
# 分解复杂任务
bun src/cli/index.ts ai batch-decompose -t <parentTaskId>

# 检查冲突
bun src/cli/index.ts schedule conflicts -w default

# 获取时间建议
bun src/cli/index.ts schedule suggest-time -w default -t <taskId>
```
