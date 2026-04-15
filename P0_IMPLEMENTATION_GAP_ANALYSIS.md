# P0 功能实现差距分析

基于 AI_FEATURES_ROADMAP.md 中的 P0 功能，分析当前代码实现的完成度和缺失部分。

---

## 当前已实现的基础能力

### 1. 数据层基础
✅ **已有**
- `TaskProjection` 模型：包含任务的调度状态、优先级、时间等信息
- `ScheduleProposal` 模型：AI 提出的日程建议
- `get-schedule-page.ts`：聚合日程数据的查询逻辑
- 基础指标计算：
  - `overloadedMinutes`：工作量过载检测（单日超过8小时）
  - `fragmentedMinutes`：碎片化时间检测（<90分钟的任务）
  - `riskLevel`：风险等级（low/medium/high）
  - `automationCandidates`：自动化候选任务（auto_schedule, remind, decompose, auto_run）

### 2. 前端展示基础
✅ **已有**
- Schedule Page 主界面：timeline 视图、list 视图
- 左侧边栏：mini calendar + today focus
- 右侧边栏：queue、risks、proposals 三个 tab
- Header 工具栏：显示指标统计（包括 suggestions 数量）
- 基础的 drag & drop 交互

---

## P0-1: 智能冲突检测与解决建议

### 缺失部分

#### 后端 - AI 推理服务
❌ **缺失**
- [ ] AI 推理接口：`POST /api/schedule/analyze-conflicts`
  - 输入：workspaceId, date range
  - 输出：冲突报告 + 解决建议
- [ ] AI 推理逻辑模块：`src/modules/ai/conflict-analyzer.ts`
  - 时间重叠检测（同一时段多个任务）
  - 工作量过载检测（增强现有的 overloadedMinutes 逻辑）
  - 碎片化检测（增强现有的 fragmentedMinutes 逻辑）
  - 依赖关系冲突检测（需要读取 TaskDependency）
- [ ] 建议生成逻辑：`src/modules/ai/conflict-resolver.ts`
  - 延后低优先级任务
  - 拆分大任务到多个时段
  - 合并碎片时间
  - 调整任务顺序以满足依赖关系
  - 推荐最小代价的调整方案

#### 数据库
❌ **缺失**
- [ ] 新增表：`ConflictReport`（可选，用于缓存冲突分析结果）
  ```prisma
  model ConflictReport {
    id          String   @id @default(cuid())
    workspaceId String
    dayKey      String
    conflicts   Json     // 冲突详情
    suggestions Json     // 解决建议
    createdAt   DateTime @default(now())
    
    @@index([workspaceId, dayKey])
  }
  ```

#### 前端 - 冲突展示与交互
❌ **缺失**
- [ ] 冲突卡片组件：`src/components/schedule/conflict-card.tsx`
  - 显示冲突类型、涉及的任务、严重程度
  - 展示 AI 建议的解决方案
  - 支持"接受"、"拒绝"、"修改"操作
- [ ] 右侧边栏新增 tab：`conflicts`（或增强现有的 `risks` tab）
- [ ] Timeline 视图增强：
  - 冲突任务高亮显示（红色边框或背景）
  - 建议方案的前后对比（可选：split view）
- [ ] 一键应用建议的 API 调用：
  - `POST /api/schedule/apply-suggestion`
  - 批量更新任务的 scheduledStartAt/scheduledEndAt

#### 适配器层
✅ **无需修改**（冲突检测是纯前端/后端逻辑，不涉及 runtime adapter）

---

## P0-2: 自动执行与提醒策略

### 缺失部分

#### 后端 - AI 推理服务
❌ **缺失**
- [ ] AI 推理接口：`POST /api/tasks/suggest-automation`
  - 输入：taskId, task metadata（title, description, priority, dueAt）
  - 输出：推荐的执行方式、提醒策略、准备工作
- [ ] AI 推理逻辑模块：`src/modules/ai/automation-suggester.ts`
  - 执行方式判断（立即/定时/周期/需确认）
  - 提醒策略（提前时间、频率、渠道）
  - 主动式任务准备：
    - 识别任务依赖的资源和前置条件
    - 自动收集相关上下文（文档、历史讨论）
    - 提前检查资源可用性
- [ ] 提醒调度器：`src/modules/scheduler/reminder-scheduler.ts`
  - 定时检查即将开始的任务
  - 触发提醒通知（需要通知系统支持）
  - 收集任务上下文信息

#### 数据库
❌ **缺失**
- [ ] 扩展 `Task` 表（或新增 `TaskAutomation` 表）：
  ```prisma
  model TaskAutomation {
    id                String   @id @default(cuid())
    taskId            String   @unique
    executionMode     String   // "immediate" | "scheduled" | "recurring" | "manual"
    reminderStrategy  Json     // { advanceMinutes, frequency, channels }
    preparationSteps  Json     // 准备工作清单
    contextSources    Json     // 相关文档、讨论链接
    resourceChecks    Json     // 需要检查的资源
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    
    task Task @relation(fields: [taskId], references: [id])
  }
  ```

#### 前端 - 自动化配置 UI
❌ **缺失**
- [ ] 任务创建/编辑时的 AI 建议面板：
  - 在 `TaskCreateDialog` 中集成 AI 建议
  - 显示推荐的执行方式、提醒策略
  - 支持一键应用或手动调整
- [ ] 准备工作清单组件：`src/components/schedule/preparation-checklist.tsx`
  - 显示任务开始前需要准备的事项
  - 显示自动收集的上下文信息（文档链接、历史讨论）
  - 资源可用性检查结果
- [ ] 提醒设置面板：
  - 在任务详情页或 SelectedBlockSheet 中添加
  - 可视化配置提醒时间、频率、渠道

#### 适配器层
❌ **缺失**
- [ ] 通知适配器：`src/modules/runtime/adapters/notification-adapter.ts`
  - 支持多种通知渠道（浏览器通知、邮件、消息）
  - 与提醒调度器集成
  - 处理用户的通知偏好设置

---

## 实现优先级建议

### Phase 1: 冲突检测基础（1-2周）
1. **后端 AI 推理服务**
   - 实现 `/api/schedule/analyze-conflicts` 接口
   - 实现基础的冲突检测逻辑（时间重叠、工作量过载）
   - 生成简单的解决建议（延后低优先级任务）

2. **前端冲突展示**
   - 实现 `ConflictCard` 组件
   - 在右侧边栏的 `risks` tab 中展示冲突
   - Timeline 视图中高亮冲突任务

3. **应用建议功能**
   - 实现 `/api/schedule/apply-suggestion` 接口
   - 支持一键应用 AI 建议

### Phase 2: 自动化建议基础（1-2周）
1. **后端 AI 推理服务**
   - 实现 `/api/tasks/suggest-automation` 接口
   - 实现基础的执行方式判断和提醒策略推荐

2. **前端自动化配置 UI**
   - 在 `TaskCreateDialog` 中集成 AI 建议
   - 显示推荐配置，支持一键应用

3. **数据库扩展**
   - 添加 `TaskAutomation` 表
   - 存储用户接受的自动化配置

### Phase 3: 主动式任务准备（2-3周）
1. **上下文收集**
   - 实现相关文档和历史讨论的自动收集
   - 集成到任务详情页

2. **提醒调度器**
   - 实现定时检查和提醒触发逻辑
   - 集成通知系统

3. **准备工作清单**
   - 实现 `PreparationChecklist` 组件
   - 显示任务开始前的准备事项

### Phase 4: 高级功能迭代（2-3周）
1. **依赖关系冲突检测**
   - 读取 `TaskDependency` 表
   - 检测前置任务未完成的情况

2. **碎片化优化建议**
   - 合并碎片时间的智能建议
   - 任务拆分和重组

3. **资源可用性检查**
   - 会议室、设备、人员的可用性检查
   - 提前预警资源冲突

---

## 技术栈建议

### AI 推理服务
**选项 1：直接调用 LLM API**
- OpenAI GPT-4 / Claude
- 优点：快速实现，效果好
- 缺点：成本较高，需要 API key

**选项 2：本地模型**
- Ollama + Llama 3 / Mistral
- 优点：成本低，隐私好
- 缺点：需要部署，效果可能不如商业模型

**选项 3：混合方案**
- 简单规则用本地逻辑（时间重叠检测）
- 复杂推理用 LLM（建议生成、上下文理解）

### 推荐实现路径
1. **Phase 1-2**：使用规则引擎 + 简单的启发式算法
   - 时间重叠、工作量过载用纯逻辑实现
   - 建议生成用模板 + 规则
   - 快速验证产品价值

2. **Phase 3-4**：引入 LLM
   - 上下文收集、准备工作识别需要 NLP 能力
   - 可以先用 OpenAI API 快速验证
   - 后续根据成本和效果决定是否切换到本地模型

---

## 成功指标

### Phase 1 完成标准
- [ ] 能检测出时间重叠和工作量过载
- [ ] 能生成至少 2 种类型的解决建议
- [ ] 用户可以一键应用建议
- [ ] 冲突任务在 Timeline 中高亮显示

### Phase 2 完成标准
- [ ] 创建任务时能看到 AI 推荐的执行方式和提醒策略
- [ ] 用户可以接受或修改推荐配置
- [ ] 配置保存到数据库

### Phase 3 完成标准
- [ ] 任务开始前 10 分钟收到提醒
- [ ] 提醒中包含准备工作清单
- [ ] 自动收集的上下文信息可点击查看

### Phase 4 完成标准
- [ ] 能检测依赖关系冲突
- [ ] 能生成碎片化优化建议
- [ ] 资源可用性检查正常工作

---

## CLI 客户端架构设计

### 设计理念

**问题**：OpenClaw/Claude Code 等 AI Agent 不支持或不完善结构化返回功能，直接让前端向后端请求 AI 建议不合适。

**解决方案**：创建 CLI 客户端 + Skill，让 AI 通过 terminal 调用 CLI 来操作后端。

### 架构图

```
┌─────────────────────────────────────────────────┐
│                   前端 UI                        │
│  (用户手动操作 + 展示 AI 生成的建议)              │
└────────────────┬────────────────────────────────┘
                 │
                 │ HTTP
                 ▼
┌─────────────────────────────────────────────────┐
│              后端 API 层                         │
│  /api/schedule/projection (现有)                │
│  /api/ai/analyze-conflicts (新增)               │
│  /api/ai/apply-suggestion (新增)                │
│  /api/ai/suggest-automation (新增)              │
└────────────────┬────────────────────────────────┘
                 │
                 │ 共享业务逻辑
                 ▼
┌─────────────────────────────────────────────────┐
│           CLI 客户端 (新增)                      │
│  agentdash analyze-conflicts --workspace=xxx    │
│  agentdash suggest-automation --task=xxx        │
│  agentdash apply-suggestion --suggestion=xxx    │
└────────────────┬────────────────────────────────┘
                 │
                 │ 调用
                 ▼
┌─────────────────────────────────────────────────┐
│          AI Agent (OpenClaw/Claude)             │
│  使用 skill 调用 CLI，生成建议并应用             │
└─────────────────────────────────────────────────┘
```

### CLI 项目结构

```
src/cli/
├── index.ts                    # CLI 入口（Commander.js）
├── commands/
│   ├── analyze-conflicts.ts    # 冲突分析命令
│   ├── suggest-automation.ts   # 自动化建议命令
│   ├── apply-suggestion.ts     # 应用建议命令
│   └── get-workspace.ts        # 获取工作空间信息
└── lib/
    ├── api-client.ts           # HTTP 客户端（调用本地后端）
    └── output-formatter.ts     # 格式化输出（JSON/表格）
```

### CLI 命令设计

#### 1. 分析冲突
```bash
agentdash analyze-conflicts \
  --workspace=ws_123 \
  --date=2026-04-15 \
  --output=json

# 输出示例
{
  "conflicts": [
    {
      "type": "time_overlap",
      "severity": "high",
      "tasks": ["task_1", "task_2"],
      "timeRange": "2026-04-15T09:00:00Z/2026-04-15T10:00:00Z"
    }
  ],
  "suggestions": [
    {
      "id": "sugg_1",
      "type": "reschedule",
      "description": "Move 'Task 2' to 10:00-11:00",
      "affectedTasks": ["task_2"],
      "changes": {
        "task_2": {
          "scheduledStartAt": "2026-04-15T10:00:00Z",
          "scheduledEndAt": "2026-04-15T11:00:00Z"
        }
      }
    }
  ]
}
```

#### 2. 建议自动化配置
```bash
agentdash suggest-automation \
  --task=task_123 \
  --output=json

# 输出示例
{
  "executionMode": "scheduled",
  "reminderStrategy": {
    "advanceMinutes": 10,
    "frequency": "once",
    "channels": ["notification"]
  },
  "preparationSteps": [
    "Review meeting agenda",
    "Prepare presentation slides"
  ],
  "contextSources": [
    {"type": "document", "url": "/docs/agenda.pdf"},
    {"type": "discussion", "url": "/tasks/task_100"}
  ]
}
```

#### 3. 应用建议
```bash
agentdash apply-suggestion \
  --workspace=ws_123 \
  --suggestion-id=sugg_1 \
  --confirm
```

### API 端点设计

#### POST /api/ai/analyze-conflicts
```typescript
// 请求
{
  "workspaceId": "ws_123",
  "date": "2026-04-15"
}

// 响应
{
  "conflicts": [...],
  "suggestions": [...]
}
```

#### POST /api/ai/suggest-automation
```typescript
// 请求
{
  "taskId": "task_123"
}

// 响应
{
  "executionMode": "scheduled",
  "reminderStrategy": {...},
  "preparationSteps": [...],
  "contextSources": [...]
}
```

#### POST /api/ai/apply-suggestion
```typescript
// 请求
{
  "workspaceId": "ws_123",
  "suggestionId": "sugg_1",
  "changes": {
    "task_2": {
      "scheduledStartAt": "2026-04-15T10:00:00Z",
      "scheduledEndAt": "2026-04-15T11:00:00Z"
    }
  }
}

// 响应
{
  "success": true,
  "appliedChanges": [...]
}
```

### Skill 文档

创建 `agentdashboard-ai-operations.md` skill，包含：
- CLI 命令使用说明
- 典型工作流示例
- 输出格式说明
- 错误处理指南

### 技术栈

- **CLI 框架**：Commander.js（轻量、TypeScript 支持好）
- **HTTP 客户端**：fetch（Node.js 18+ 内置）
- **输出格式化**：chalk（彩色输出）+ cli-table3（表格）

---

## 下一步行动（前后端优先）

### Phase 1: 冲突检测后端（2-3天）
1. [ ] 创建冲突检测逻辑模块：`src/modules/ai/conflict-detector.ts`
   - 时间重叠检测（同一时段多个任务）
   - 工作量过载检测（增强现有 overloadedMinutes）
   - 碎片化检测（增强现有 fragmentedMinutes）
   - 依赖关系冲突检测（读取 TaskDependency）
2. [ ] 创建建议生成模块：`src/modules/ai/suggestion-generator.ts`
   - 延后低优先级任务
   - 拆分大任务到多个时段
   - 合并碎片时间
   - 推荐最小代价调整方案
3. [ ] 实现 API 端点：`src/app/api/ai/analyze-conflicts/route.ts`
   - POST 接口，接收 workspaceId 和 date
   - 调用冲突检测和建议生成逻辑
   - 返回结构化的冲突报告和建议
4. [ ] 编写单元测试：`src/modules/ai/__tests__/conflict-detector.test.ts`

### Phase 2: 冲突展示前端（2-3天）
1. [ ] 创建冲突卡片组件：`src/components/schedule/conflict-card.tsx`
   - 显示冲突类型、涉及任务、严重程度
   - 展示 AI 建议的解决方案
   - 支持"接受"、"拒绝"操作
2. [ ] 扩展 schedule-page-types.ts：
   - 添加 Conflict 和 Suggestion 类型定义
3. [ ] 在 `get-schedule-page.ts` 中集成冲突检测：
   - 调用冲突检测逻辑
   - 将冲突数据添加到返回结果
4. [ ] 在右侧边栏展示冲突：
   - 在现有的 `risks` tab 中添加冲突展示
   - 或新增 `conflicts` tab
5. [ ] Timeline 视图增强：
   - 冲突任务高亮显示（红色边框）
   - 添加冲突标记图标

### Phase 3: 应用建议功能（2-3天）
1. [ ] 实现 API 端点：`src/app/api/ai/apply-suggestion/route.ts`
   - POST 接口，接收 suggestionId 和 changes
   - 批量更新任务的 scheduledStartAt/scheduledEndAt
   - 返回应用结果
2. [ ] 在 ConflictCard 中添加"应用建议"按钮
3. [ ] 实现应用建议的前端逻辑：
   - 调用 `/api/ai/apply-suggestion`
   - 刷新 schedule projection
   - 显示成功/失败提示
4. [ ] 添加确认对话框（可选）
5. [ ] 测试完整流程：检测冲突 → 展示建议 → 应用建议

### Phase 4: 自动化建议后端（2-3天）
1. [ ] 创建自动化建议模块：`src/modules/ai/automation-suggester.ts`
   - 执行方式判断（立即/定时/周期/需确认）
   - 提醒策略推荐（提前时间、频率、渠道）
   - 准备工作识别（基于任务描述和类型）
2. [ ] 实现 API 端点：`src/app/api/ai/suggest-automation/route.ts`
   - POST 接口，接收 taskId
   - 返回推荐的自动化配置
3. [ ] 扩展数据库（可选）：
   - 添加 TaskAutomation 表存储配置
   - 或在 Task 表中添加 JSON 字段
4. [ ] 编写单元测试

### Phase 5: 自动化建议前端（2-3天）
1. [ ] 在 `TaskCreateDialog` 中集成 AI 建议：
   - 创建任务时调用 `/api/ai/suggest-automation`
   - 显示推荐的执行方式和提醒策略
   - 支持一键应用或手动调整
2. [ ] 创建自动化配置面板组件：`src/components/schedule/automation-config-panel.tsx`
3. [ ] 在任务详情页（SelectedBlockSheet）中展示自动化配置
4. [ ] 测试自动化建议流程

### Phase 6: 主动式任务准备（后续迭代）
1. [ ] 实现准备工作清单组件：`src/components/schedule/preparation-checklist.tsx`
2. [ ] 实现上下文收集逻辑（相关文档、历史讨论）
3. [ ] 实现资源可用性检查
4. [ ] 集成到任务详情页

### Phase 7: CLI 客户端 ✅ 完成
1. [x] 创建 CLI 基础框架（Commander.js）
2. [x] 实现 `agentdash analyze-conflicts` 命令
3. [x] 实现 `agentdash suggest-automation` 命令
4. [x] 实现 `agentdash apply-suggestion` 命令
5. [x] 编写 skill 文档：`agentdashboard-ai-operations.md`
6. [x] 测试 CLI → API 完整流程

### Phase 8: AI Agent 化重构 ✅ 完成
1. [x] 后端任务管理 REST API 完整覆盖
   - GET/POST /api/tasks, GET/PATCH /api/tasks/[taskId]
   - POST /api/tasks/[taskId]/run, /done, /reopen, /message, /input, /plan
   - POST/DELETE /api/tasks/[taskId]/schedule
2. [x] CLI 重新设计为 AI Agent 友好的分组命令
   - task 组: list, get, create, update, done, reopen, plan
   - run 组: start, message, input
   - schedule 组: apply, clear, view, conflicts, suggest-time
   - ai 组: decompose, suggest-automation, apply-suggestion
3. [x] OpenClaw 适配器增强
   - 有状态 Mock 适配器支持完整 session 生命周期
   - 支持 approval 工作流和多轮对话
   - 可配置 completionDelay, autoComplete, failRate, requireApproval
4. [x] 端到端集成测试
   - 31 个 mock adapter 单元测试
   - 12 个任务生命周期集成测试
   - 全量测试通过: vitest 31 files, bun 123 tests
5. [x] 综合 Skill 文档更新（821 行完整参考）
