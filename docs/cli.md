# CLI 参考手册

## 概述

AgentDashboard CLI (`agentdash`) 是一个面向 AI Agent 友好的命令行工具，默认输出结构化 JSON。

```bash
bun run agentdash <命令组> <命令> [选项]
```

### 全局选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--base-url <url>` | API 基础地址 | `http://localhost:3000` |
| `--version` | 显示版本号 | — |
| `--help` | 显示帮助信息 | — |

### 输出格式

所有命令支持 `-o, --output <format>` 选项：

- `json` (默认): 结构化 JSON 输出，适合程序解析
- `table`: 人类可读的表格格式

---

## 命令组

### task — 任务管理

#### task list

列出任务。

```bash
bun run agentdash task list
bun run agentdash task list -o table
```

#### task get

获取单个任务详情。

```bash
bun run agentdash task get <taskId>
bun run agentdash task get abc123 -o json
```

#### task create

创建新任务。

```bash
bun run agentdash task create --title "实现用户认证" --priority High
bun run agentdash task create --title "修复 Bug" --priority Medium --status Ready
```

#### task update

更新任务属性。

```bash
bun run agentdash task update <taskId> --title "新标题" --priority Low
```

#### task done

将任务标记为完成。

```bash
bun run agentdash task done <taskId>
```

#### task reopen

重新打开已完成的任务。

```bash
bun run agentdash task reopen <taskId>
```

#### task plan

为任务创建计划。

```bash
bun run agentdash task plan <taskId>
```

#### task delete

删除任务。

```bash
bun run agentdash task delete <taskId>
```

#### task subtasks

查看任务的子任务。

```bash
bun run agentdash task subtasks <taskId>
```

#### task add-subtask

为任务添加子任务。

```bash
bun run agentdash task add-subtask <parentTaskId> --title "子任务标题"
```

---

### run — 运行管理

#### run start

启动一个任务的运行。

```bash
bun run agentdash run start <taskId>
```

#### run message

向运行中的任务发送消息。

```bash
bun run agentdash run message <runId> --content "请继续执行下一步"
```

#### run input

向运行提供输入（响应运行时的 input 请求）。

```bash
bun run agentdash run input <runId> --data '{"answer": "yes"}'
```

---

### schedule — 日程管理

#### schedule apply

为任务应用日程安排。

```bash
bun run agentdash schedule apply <taskId> \
  --due-at "2026-04-20T18:00:00Z" \
  --start-at "2026-04-20T09:00:00Z" \
  --end-at "2026-04-20T11:00:00Z"
```

#### schedule clear

清除任务的日程安排。

```bash
bun run agentdash schedule clear <taskId>
```

#### schedule view

查看日程安排。

```bash
bun run agentdash schedule view
bun run agentdash schedule view -o table
```

#### schedule conflicts

检测日程冲突。

```bash
bun run agentdash schedule conflicts
```

#### schedule suggest-time

获取 AI 建议的时间段。

```bash
bun run agentdash schedule suggest-time <taskId>
```

---

### ai — AI 功能

#### ai decompose

使用 AI 将任务分解为子任务。

```bash
bun run agentdash ai decompose <taskId>
```

#### ai batch-decompose

批量分解多个任务。

```bash
bun run agentdash ai batch-decompose --task-ids "id1,id2,id3"
```

#### ai suggest-automation

获取 AI 自动化建议。

```bash
bun run agentdash ai suggest-automation <taskId>
```

#### ai auto-complete

AI 自动完成任务。

```bash
bun run agentdash ai auto-complete <taskId>
```

#### ai apply-suggestion

应用 AI 建议。

```bash
bun run agentdash ai apply-suggestion <suggestionId>
```

---

## 典型工作流

### 创建并规划任务

```bash
# 创建任务
bun run agentdash task create --title "开发新功能" --priority High

# AI 分解为子任务
bun run agentdash ai decompose <taskId>

# 安排日程
bun run agentdash schedule apply <taskId> \
  --start-at "2026-04-20T09:00:00Z" \
  --end-at "2026-04-20T12:00:00Z"

# 检查冲突
bun run agentdash schedule conflicts
```

### 执行任务

```bash
# 启动运行
bun run agentdash run start <taskId>

# 与运行交互
bun run agentdash run message <runId> --content "开始执行"

# 完成任务
bun run agentdash task done <taskId>
```

### 批量查看 (表格输出)

```bash
bun run agentdash task list -o table
bun run agentdash schedule view -o table
```
