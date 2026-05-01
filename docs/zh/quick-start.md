# Chrona 快速开始

2 分钟跑起来。

## Chrona 是什么

Chrona 是一个 AI 原生任务控制台，核心由两个循环组成：

- **排期** — 将模糊意图转化为具体时间块和结构化任务计划
- **执行** — 让 AI 智能体按计划推进任务，并持续更新计划

## 环境要求

| 要求 | 验证方式 |
|------|---------|
| **Node.js >= 20** | `node --version`（仅用于 npm 安装 — npm 包内置了 Bun 作为应用运行时） |
| **npm** | `npm --version`（Node.js 自带） |

```bash
# 验证 Node.js 版本（仅 npm 安装需要；运行时使用 Bun）
node --version  # 必须 >= 20.0.0
```

Chrona 使用 **Bun** 作为应用运行时。npm 包内置了 Bun 二进制文件，无需单独安装 Bun。

## 安装

```bash
npm install -g @chrona-org/cli
```

全局安装 `chrona` 命令。

## 启动

```bash
chrona start
```

首次运行会自动完成所有初始化：

1. 创建数据目录（Linux: `~/.local/share/chrona/`）
2. 创建配置文件（基于打包模板生成 `~/.config/chrona/.env`）
3. 创建 SQLite 数据库并执行 schema 迁移
4. 启动服务器于 `http://localhost:3101`

在浏览器中打开 `http://localhost:3101`。Web 应用完全在本地运行——无需云端账号。

### 数据目录

| 平台 | 数据 | 配置 |
|------|------|------|
| Linux | `~/.local/share/chrona/` | `~/.config/chrona/` |
| macOS | `~/Library/Application Support/chrona/` | `~/Library/Preferences/chrona/` |
| Windows | `%APPDATA%/chrona/` | `%APPDATA%/chrona/` |

可通过环境变量覆盖：

```bash
CHRONA_DATA_DIR=/自定义/路径/数据 chrona start
CHRONA_CONFIG_DIR=/自定义/路径/配置 chrona start
```

## 配置 AI 后端

在 Web 应用的 **设置 > AI 客户端** 页面配置。

### 方案 A：LLM（推荐快速开始）

使用任意 OpenRouter 兼容的 API。你需要：
- LLM 提供商的 API key
- 要使用的模型名称

示例配置：
```json
{
  "name": "我的 Claude",
  "type": "llm",
  "config": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### 方案 B：OpenClaw 网关

用于专用代理执行。你需要：
- 运行中的 OpenClaw 网关（默认: `http://localhost:18789`）
- 网关 token

配置完成后可在设置页面测试连接。

## CLI 用法

`chrona` 命令同时也是一个 CLI 客户端：

```bash
# 任务操作
chrona task list                                    # 列出任务
chrona task create --title "调研竞品产品"            # 创建任务
chrona task show <id>                               # 查看详情

# 运行操作
chrona run start <task-id>                          # 启动智能体运行

# 排期操作
chrona schedule list                                # 列出已排期任务

# AI 操作
chrona ai suggest --title "修复 bug"                 # AI 建议
```

所有命令都支持 `--base-url` 参数指向其他 API 服务器：

```bash
chrona task list --base-url http://其他机器:3101
```

## 第一个任务完整操作

### 1. 创建任务

进入 **排期** 页面，点击"+"按钮，描述你的工作：

```
标题：分析 Q4 销售数据
描述：从分析数据库中拉取数据，识别趋势，生成包含图表的汇总报告
```

### 2. 生成 AI 计划

点击任务的 **"生成计划"**。Chrona 会流式生成 AI 执行计划，包含类型化节点、依赖关系和工时估算。审阅计划，必要时编辑，然后 **"采纳"**。

### 3. 排期

将任务拖放到日历上以分配时间段，或使用 **"AI 建议时间段"** 让 Chrona 找到最佳时间窗口。

### 4. 运行智能体

点击任务上的 **"开始运行"**。在 **工作** 视图中查看实时对话、工具调用和进度。智能体可能会请求输入或审批——你始终掌握控制权。

### 5. 审阅与迭代

运行完成后，审阅生成的产物。接受结果或创建后续任务。

## 服务器选项

```bash
chrona start                     # 默认端口 3101
PORT=3100 chrona start           # 自定义端口
HOST=0.0.0.0 chrona start        # 绑定所有网络接口
```

生产模式下，同一端口上的单个服务器同时托管 API 和静态 SPA。

## 故障排查

### "command not found: chrona"

确保 npm 全局 bin 目录在 PATH 中：

```bash
npm config get prefix          # 例如 /home/user/.npm-global
export PATH="$PATH:$(npm config get prefix)/bin"
```

### 端口 3101 已被占用

```bash
chrona start
# 错误: listen EADDRINUSE :::3101

# 使用其他端口
PORT=3102 chrona start
```

### AI 后端无响应

1. 检查网络连通性：`curl -I https://api.openai.com/v1/models`
2. 检查 API key 是否过期
3. 在 **设置 > AI 客户端** → **测试连接** 中测试连通性

### 数据库问题

```bash
# 重置所有数据（删除所有数据！）
rm -rf ~/.local/share/chrona/chrona.db
chrona start    # 重新创建数据库
```

## 下一步

- [路线图](./roadmap.md) — 产品方向和阶段规划
- [系统架构](../architecture.md) — CQRS + 事件溯源深入解析
- [API 参考](../api-reference.md) — 完整 REST API 文档
- [数据模型](../data-model.md) — 数据库 schema 参考
