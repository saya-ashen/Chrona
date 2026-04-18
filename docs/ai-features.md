# AI 功能文档

AgentDashboard 集成了多层 AI 智能能力，采用"规则引擎 + LLM"双引擎策略，确保核心功能在无 LLM 时仍可用。

## AI 功能概览

| 功能 | 规则引擎 | LLM 增强 | OpenClaw | 说明 |
|------|---------|---------|----------|------|
| 冲突检测 | ✅ | ✅ | ❌ | 4 种冲突类型自动检测 |
| 建议生成 | ✅ | ✅ | ❌ | 冲突解决方案建议 |
| 任务分解 | ✅ | ✅ | ❌ | 复杂任务拆分为子任务 |
| 自动化建议 | ✅ | ✅ | ❌ | 执行策略建议 |
| 时间段建议 | ✅ | ❌ | ❌ | 最佳排期时间推荐 |
| 标题自动补全 | ✅ | ✅ | ✅ | 输入补全（三级回退） |
| 自动化候选 | ✅ | ❌ | ❌ | 可自动执行的任务识别 |

---

## 1. 冲突检测

### 检测的冲突类型

#### 时间重叠 (time_overlap)
两个已排期任务的时间窗口交叉。

```
任务A: 14:00 ─────── 16:00
任务B:      15:00 ─────── 17:00
             ↑ 重叠区间
```

#### 每日超载 (daily_overload)
单日排期总时长超过 8 小时阈值。

```
09:00-11:00 (2h) + 11:00-13:00 (2h) + 14:00-17:00 (3h) + 17:00-19:00 (2h) = 9h > 8h
```

#### 碎片化 (fragmentation)
存在过多短于 90 分钟的任务块，导致深度工作困难。

#### 依赖违反 (dependency_violation)
被依赖的任务尚未完成，但依赖方已安排排期。

### 使用方式

```typescript
// 纯规则引擎（快速、确定性）
import { detectAllConflicts } from "@/modules/ai/conflict-detector";
const conflicts = detectAllConflicts(scheduledTasks);

// 规则 + LLM 增强分析
import { analyzeConflictsSmart } from "@/modules/ai/conflict-analyzer";
const { conflicts, suggestions } = await analyzeConflictsSmart(scheduledTasks);
```

**API 调用：**
```bash
POST /api/ai/analyze-conflicts
{ "workspaceId": "default", "date": "2025-01-15" }
```

---

## 2. 任务分解

将复杂任务自动拆分为可执行的子任务。

### 规则引擎策略

5 种拆分策略按优先级依次尝试：

1. **描述列表识别**：识别 markdown 列表项（`- ` / `* ` / `1. `）
2. **动词模式匹配**：识别"然后"、"接着"、"之后"等连接词
3. **逗号列表分割**：按中英文逗号分割
4. **连词分割**：按"和"、"以及"、"并且"分割
5. **按时长拆分**：预估时长 > 2h 的任务按时间均分

### 输出结构

```typescript
interface TaskDecompositionResult {
  subtasks: {
    title: string;
    description?: string;
    estimatedMinutes: number;
    priority: TaskPriority;
  }[];
  totalEstimatedMinutes: number;
  feasibilityScore: number;    // 0-1，可行性评分
  warnings: string[];
}
```

### 使用方式

```bash
# CLI: 仅分解（预览）
bun src/cli/index.ts ai decompose -t <taskId>

# CLI: 分解 + 创建子任务
bun src/cli/index.ts ai batch-decompose -t <taskId>
```

---

## 3. 时间段建议

为任务推荐最佳排期时间。

### 考虑因素

- **空闲窗口**：寻找时间线上的空闲间隙
- **优先级**：高优先级任务优先获得黄金时段
- **时段偏好**：上午适合深度工作，下午适合协作
- **碎片化**：避免产生过短的空闲碎片
- **截止日期**：临近截止的任务优先排期

### 输出

```typescript
interface TimeslotSuggestion {
  startAt: Date;
  endAt: Date;
  score: number;           // 推荐得分
  reason: string;          // 推荐理由
}
```

---

## 4. 标题自动补全

输入 ≥ 3 个字符时触发，提供任务标题建议。

### 三级回退链

```
OpenClaw Gateway → 直接 LLM → 中文关键词规则
```

#### Level 1: OpenClaw Gateway
通过 WebSocket 会话与 OpenClaw 智能体对话，获取上下文感知的建议。

**特点：**
- 每个工作空间独立会话
- 首次连接发送系统提示词（包含排期上下文）
- 可调用插件工具获取实时数据

#### Level 2: 直接 LLM
使用 OpenAI 兼容 API 直接生成建议。

#### Level 3: 中文关键词规则
基于关键词匹配的确定性规则：

```
"分析" → [分析用户行为数据, 分析系统性能瓶颈, 分析竞品功能, ...]
"部署" → [部署生产环境, 部署测试服务器, 部署 CI/CD 流水线, ...]
"审查" → [代码审查, 安全审查, 设计审查, ...]
```

### 前端集成

```tsx
import { useAutoComplete } from "@/hooks/use-ai";

function CommandBar() {
  const [input, setInput] = useState("");
  const { suggestions } = useAutoComplete(
    input.length >= 3 ? input : null
  );
  
  return (
    <div>
      <input value={input} onChange={e => setInput(e.target.value)} />
      {suggestions.map(s => (
        <SuggestionItem key={s.title} suggestion={s} />
      ))}
    </div>
  );
}
```

---

## 5. 自动化建议

为任务建议最佳执行策略。

### 建议内容

```typescript
interface AutomationSuggestion {
  executionMode: "auto" | "supervised" | "manual";
  reminderStrategy: string;
  prepSteps: string[];
}
```

---

## 6. 自动化候选 (Automation Candidates)

排期页面自动识别可自动化处理的任务。

### 候选类型

| 类型 | 说明 | 识别规则 |
|------|------|---------|
| `auto_schedule` | 可自动排期 | 未排期 + 有待处理的 AI 排期建议 |
| `decompose` | 需要分解 | 未排期 + 不可运行（缺配置） |
| `remind` | 需要提醒 | 风险项 + 等待用户操作 |
| `auto_run` | 可自动执行 | 已排期 + 可运行 + 无审批阻塞 |

### auto_run 详细规则

1. 任务已排期 (`scheduleStatus !== "Unscheduled"`)
2. 任务可运行 (`isRunnable === true`)
3. 无待审批 (`approvalPendingCount === 0`)
4. 非等待状态（非 `WaitingForInput` / `WaitingForApproval`）
5. 无需用户操作（非 `Schedule task` / `Reschedule task`）
6. 不在风险列表中
7. 优先级：High/Urgent → high，其他 → medium

---

## 7. OpenClaw 插件工具

当 OpenClaw 智能体在生成建议时，可调用以下工具获取实时数据：

### schedule.list_tasks
列出工作空间的任务。

```json
{
  "tool_name": "schedule.list_tasks",
  "arguments": { "workspace_id": "default" }
}
```

### schedule.get_health
获取排期健康状态。

```json
{
  "tool_name": "schedule.get_health",
  "arguments": { "workspace_id": "default" }
}
```

### schedule.check_conflicts
检查排期冲突。

```json
{
  "tool_name": "schedule.check_conflicts",
  "arguments": { "workspace_id": "default" }
}
```

---

## AI 配置

### 环境变量

```env
# LLM 配置（OpenAI 兼容）
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=ws://localhost:8080
OPENCLAW_API_KEY=your-key
```

### 降级策略

| LLM 可用 | OpenClaw 可用 | 行为 |
|---------|-------------|------|
| ✅ | ✅ | 全功能 |
| ✅ | ❌ | 跳过 OpenClaw 层，LLM 直接生成 |
| ❌ | ✅ | OpenClaw 生成建议，本地规则引擎兜底 |
| ❌ | ❌ | 纯规则引擎（冲突检测、关键词补全等仍可用） |
