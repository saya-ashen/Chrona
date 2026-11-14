# Chat

Chat 是 Chrona 的独立中文对话工作台，管理自己的会话、草稿、图片、工具选择和执行记录。对话通过 Chrona Agent 与已安装的 Provider 执行；界面通过 Web 的标准组件与页面注册机制提供。

使用前需要已配置且可用的对话 Provider，以及已安装并绑定的 Web 应用。Chat 的入口、权限与工具声明见 `module.json`；应用激活时注册 `chat:Workbench` 组件和 `main` 工作区页面。

## 使用

- 在 Chat 页面新建或切换会话。会话支持搜索、重命名、置顶、归档及确认删除。
- 在“工具与设置”中选择对话提供方、应用工具，并在输入区选择下一轮模型和思考强度。新会话默认选择当前可委派的应用工具；每轮最多 100 个，超出时可关闭工具后手动选择。设置变更用于下一轮。
- 输入消息后点击“发送”，或按 `Ctrl / ⌘ + Enter`。支持 PNG、JPEG、GIF、WebP 图片，每张最多 2 MiB、每会话最多 10 张；Provider 需支持图片输入。
- 运行中可以补充指令、回答交互问题或请求停止。请求结果未知时，在“执行详情”中按原请求核对。停止请求与任务观测状态分别保存；停止尚未确认时继续保留占用。
- “新执行上下文”保留 Chat 消息，并让后续执行使用新的 Provider 上下文。“应用交付”按提交回执核对应用状态；提交、批准、激活和浏览器验收分别显示。

会话及操作记录保存在宿主提供的应用私有数据目录内的 `chat.sqlite`，图片保存在应用私有内容目录。浏览器还会保存本机草稿，以便恢复尚未完成保存的输入。应用不使用固定的工作区路径或数据目录。

## 开发与构建

在本目录运行，使用 Bun 和锁定依赖：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test
bun run build
```

`build.ts` 将 `ui.ts` 及其依赖打包为浏览器产物 `dist/ui.js`；`ui.css` 直接用于组件注册。宿主从 `index.ts` 启动应用。`chrona-material.json` 列出源码、构建命令及产物摘要；修改或重建产物后应同步摘要和实际使用的工具链版本。

主要文件：

| 文件 | 职责 |
| --- | --- |
| `index.ts`、`module.json` | 应用入口、工具合同与 Web 注册 |
| `state.ts` | 私有会话存储、操作快照与执行恢复 |
| `client-state.ts` | 浏览器草稿及会话选择状态 |
| `tool-selection.ts`、`delivery.ts` | 工具发现与选择、交付回执识别 |
| `ui.ts`、`ui.css` | 工作台界面与样式 |
| `test-support/` | Web 注册测试工具与浏览器预览样式夹具 |

## 验证

`bun run test` 显式运行六个离线 Bun 套件：`state.test.ts`、`dom.test.ts`、`race.bun.test.ts`、`web-registration.bun.test.ts`、`selection.bun.test.ts` 和 `create.bun.test.ts`。它们检查状态恢复、DOM 生命周期、客户端竞态、组件与页面注册、工具选择和会话创建，不调用真实模型。注册测试使用随包提供的 Web 合同测试工具；不代表实际安装或浏览器验收。

`host-agent.integration.test.ts` 是额外的 Chrona 仓库集成测试，使用当前 checkout 的内核、临时数据库和离线 Provider 替身。它依赖仓库依赖及已生成的 Prisma 客户端，不属于上述六个独立套件。仓库数据库模块还会在导入时初始化测试库，因此从本目录运行时需显式指定 checkout 内的迁移目录，并隔离默认数据库与配置：

```sh
(
  mkdir -p node_modules/.cache
  test_dir="$(mktemp -d "$PWD/node_modules/.cache/chat-host-test.XXXXXX")"
  trap 'rm -rf "$test_dir"' EXIT
  TMPDIR="$test_dir" \
  CHRONA_CONFIG_DIR="$test_dir/config" \
  DATABASE_URL="file:$test_dir/root-test.db" \
  CHRONA_MIGRATIONS_DIR="$PWD/../../../../../../../prisma/migrations" \
  bun test ./host-agent.integration.test.ts
)
```

`test.ts` 是 `module.json` 声明的应用检查入口，还使用宿主提供的 `chrona/testing` SDK 进程测试工具；应通过 Chrona 的应用检查流程运行。

浏览器预览先执行 `bun run build` 和 `bun run browser-fixture.ts`，生成 `browser-fixture.html`。通过本地静态 HTTP 服务打开该文件后，可用 Playwright 执行 `browser-check.js` 中的页面函数。该函数覆盖明暗主题、三种视口及五种合成场景，并将本次截图写入 `screenshots/`。`playwright.config.json` 提供本机 Chromium 路径示例，其他环境需调整。预览使用本地 `test-support/host-style.css` 样式夹具和合成数据，不连接运行中的服务或真实模型；检查脚本的存在不表示检查已执行。
