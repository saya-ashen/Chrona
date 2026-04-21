# 快速开始（详细版）

本页补充主 README 与 `docs/zh/quick-start.md` 的细节，重点覆盖当前仓库里已经验证过的命令、CLI 用法，以及 OpenClaw 结构化结果链路。

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Bun | 1.x | 包管理器 + 运行时 |
| Git | 2.x | 版本控制 |
| OpenClaw（可选） | 本地可执行命令 | 仅在测试 bridge / 插件时需要 |

> 注意：本仓库默认使用 Bun，不使用 npm / yarn。

## 安装与初始化

```bash
git clone <repo-url> Chrona
cd Chrona
bun install
bunx prisma generate
bun run db:seed
```

说明：
- `bunx prisma generate` 已验证可用。
- `bun run db:seed` 是当前仓库主推荐初始化命令。
- `bunx prisma db push` 在当前仓库/环境下并不稳定，因此不再作为主流程文档命令。

## 启动应用

开发模式：

```bash
bun run dev
```

默认访问地址：
- http://localhost:3000

生产构建命令保留如下，但本次文档更新未专门跑完整构建验证：

```bash
bun run build
bun run start
```

## OpenClaw：结构化结果插件与 Bridge

### 1. 安装结构化结果插件

```bash
bun run openclaw:plugin:install
```

这个命令已经实际验证过，会执行以下动作：
- 构建 `packages/openclaw-plugin-structured-result`
- 安装到本地 OpenClaw，插件 id 为 `chrona-structured-result`
- 启用插件
- 尝试重启 OpenClaw gateway

验证结论：
- 插件安装与启用成功
- gateway 重启步骤可能因为本地 systemctl / service 管理方式不同而失败，此时需要你手动重启 OpenClaw gateway 或 bridge 进程
- OpenClaw 可能提示 `plugins.allow` 为空；如果你要更严格的信任策略，请在 OpenClaw 配置中显式固定允许的插件 id

### 2. 启动 OpenClaw Bridge

```bash
bun run services/openclaw-bridge/server.ts
```

说明：
- 这个入口实际启动 `services/openclaw-bridge/server.ts`，再委托到 `packages/openclaw-bridge/src/server.ts`
- 默认监听 `http://localhost:7677`
- 如果端口 `7677` 已被占用，bridge 会立刻退出并报 address-in-use 错误

## CLI 使用

当前 CLI 入口统一为：

```bash
bun run chrona --help
```

兼容别名 `agentdash` 仍然可用，但只是同一个入口的历史别名，不再推荐在文档中继续强调。

### 已验证的命令组

```bash
bun run chrona --help
bun packages/cli/src/index.ts task --help
bun packages/cli/src/index.ts run --help
bun packages/cli/src/index.ts schedule --help
bun packages/cli/src/index.ts ai --help
```

当前命令组包括：
- `task`: list / get / create / update / done / reopen / delete / subtasks / add-subtask
- `run`: start / message / input
- `schedule`: apply / clear / view / conflicts / suggest-time
- `ai`: decompose / suggest-automation / apply-suggestion / batch-decompose / auto-complete

### 示例

创建任务：

```bash
bun packages/cli/src/index.ts task create \
  -w <workspaceId> \
  --title "分析用户数据" \
  --description "使用 Python 分析最近30天的用户行为数据" \
  --priority High \
  --adapter openclaw \
  --model gpt-4o
```

应用排期：

```bash
bun packages/cli/src/index.ts schedule apply \
  -t <taskId> \
  --start "2025-01-15T14:00:00" \
  --end "2025-01-15T15:00:00"
```

启动运行：

```bash
bun packages/cli/src/index.ts run start -t <taskId>
```

标记完成：

```bash
bun packages/cli/src/index.ts task done -t <taskId>
```

## OpenClaw 结构化结果链路

当前仓库已经把 OpenClaw 结构化结果能力整理为更清晰的链路：
- 插件：`packages/openclaw-plugin-structured-result`
- Bridge：`packages/openclaw-bridge`
- 兼容入口：`services/openclaw-bridge/server.ts`
- Runtime client：`packages/runtime-client`
- AI 客户端消费层：`src/modules/ai/client/*`

关键规则：
- 结构化任务必须通过 `submit_structured_result` 工具提交机器可读结果
- bridge/client 解析工具调用参数，而不是把 assistant 自由文本当成最终机器结果
- README / quick-start 现在都以这个插件安装命令作为正式启用方式

## 测试与验证命令

```bash
bun run test
bun run chrona --help
bun packages/cli/src/index.ts task --help
bun packages/cli/src/index.ts run --help
bun packages/cli/src/index.ts schedule --help
bun packages/cli/src/index.ts ai --help
```

补充说明：
- `bun run test` 是当前主测试入口
- 本次文档更新没有把不稳定或未验证的命令继续保留在主流程里

## 当前目录结构（已按现状更新）

```text
Chrona/
├── docs/
├── packages/
│   ├── cli/
│   ├── openclaw-bridge/
│   ├── openclaw-plugin-structured-result/
│   └── runtime-client/
├── prisma/
├── services/
│   └── openclaw-bridge/
├── src/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── i18n/
│   ├── lib/
│   └── modules/
├── scripts/
├── package.json
└── tsconfig.json
```

如果你只想快速开始，优先阅读：
- `README.md`
- `docs/zh/quick-start.md`
- `docs/architecture.md`
- `docs/api-reference.md`
