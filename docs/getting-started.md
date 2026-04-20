# 快速开始

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Bun | 1.0+ | JavaScript 运行时（替代 Node.js） |
| Git | 2.0+ | 版本控制 |

> **注意**：本项目使用 Bun 作为包管理器和运行时，不使用 npm/yarn。

## 安装

```bash
# 克隆仓库
git clone <repo-url> AgentDashboard
cd AgentDashboard

# 安装依赖
bun install

# 生成 Prisma 客户端
bunx prisma generate

# 初始化数据库（创建 SQLite 文件 + 运行迁移）
bunx prisma db push

# （可选）填充种子数据
bunx prisma db seed
```

## 环境变量

创建 `.env` 文件：

```env
# 数据库（默认使用 SQLite）
DATABASE_URL="file:./dev.db"

# OpenClaw CLI Bridge（AI 智能体运行时）
OPENCLAW_MODE="bridge"
OPENCLAW_BRIDGE_URL="http://localhost:7677"
OPENCLAW_TIMEOUT="300"

# LLM 服务（可选，用于 AI 增强功能）
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"  # 或其他 OpenAI 兼容 API
OPENAI_MODEL="gpt-4o"

# 应用配置
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## 启动

### 开发模式

```bash
bun dev
```

访问 http://localhost:3000

### 生产构建

```bash
bun run build
bun start
```

## 基本使用流程

### 1. 创建任务

在 Web UI 的任务中心或排期页面创建任务，也可通过 CLI：

```bash
bun cli/index.ts task create \
  -w <workspaceId> \
  --title "分析用户数据" \
  --description "使用 Python 分析最近30天的用户行为数据" \
  --priority High \
  --adapter openclaw \
  --model gpt-4o
```

### 2. 排期

在排期页面的时间线上点击空白区域创建排期，或通过命令栏快速创建：

```
# 命令栏支持自然语言
"下午2点到3点 分析用户数据"
"明天上午 代码审查 @High"
```

也可通过 CLI：

```bash
bun cli/index.ts schedule apply \
  -t <taskId> \
  --start "2025-01-15T14:00:00" \
  --end "2025-01-15T15:00:00"
```

### 3. 执行

启动 AI 智能体执行任务：

```bash
bun cli/index.ts run start -t <taskId>
```

或在 Web UI 的工作台页面点击"运行"按钮。

### 4. 审批

当智能体遇到需要人工审批的操作时：
- 收件箱会出现审批请求
- 在工作台页面可以审批/拒绝/编辑后审批

### 5. 完成

```bash
bun cli/index.ts task done -t <taskId>
```

## CLI 快速参考

```bash
# 查看所有命令
bun cli/index.ts --help

# 任务管理
bun cli/index.ts task list -w <workspaceId>
bun cli/index.ts task get -t <taskId>

# AI 功能
bun cli/index.ts ai decompose -t <taskId>      # AI 任务分解
bun cli/index.ts ai auto-complete --title "分析" # 标题自动补全

# 排期
bun cli/index.ts schedule view -w <workspaceId> # 查看排期
bun cli/index.ts schedule conflicts -w <wId>    # 冲突分析
```

## 测试

```bash
# 组件/UI 测试（Vitest）
bunx vitest run

# 查询/数据库测试（Bun Test）
bun test src/modules/queries/__tests__/

# E2E 测试（Playwright）
bunx playwright test

# 单文件测试
bunx vitest run src/components/schedule/schedule-command-bar.test.tsx
```

## 项目结构速览

```
AgentDashboard/
├── docs/               # 本文档
├── prisma/
│   ├── schema.prisma   # 数据库模型定义
│   └── seed.ts         # 种子数据
├── src/
│   ├── app/            # Next.js 页面 + API 路由
│   ├── cli/            # 命令行工具
│   ├── components/     # React UI 组件
│   ├── hooks/          # React Hooks
│   ├── i18n/           # 国际化
│   ├── lib/            # 共享工具
│   └── modules/        # 核心业务逻辑
├── package.json
└── tsconfig.json
```
