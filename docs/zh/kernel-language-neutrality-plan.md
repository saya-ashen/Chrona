# 内核语言无关化实施方案

状态：2026-11-09 方案，未开始实施。依据为当日 `platform-v2` 工作树源码；文中行号仅用于定位，以实施时源码为准。

## 1. 目标与判定标准

目标：将来如果把**内核和内置 Agent 应用一起**换成别的语言（例如 Rust）重写，所有普通应用（Web、Notify、QQ、Author、Coding、用户构建的应用等）**不改一行代码、不丢一条持久绑定**，就能继续工作。为了让结构更清楚，本方案同时把 Agent 改成自包含模块：内核与 Agent 之间只通过合同包通信，不再互相 import 实现代码。

完成后必须同时满足：

1. 内核（`packages/engine/src/modules/steward/*.ts`、`system/`、`apps/server`）不 import `builtin/agent/**`；Agent 也不通过相对路径 import 自身目录以外的任何文件。两者唯一共享的是 `@chrona/contracts` 中的合同，以及 `@chrona/pi`、`@chrona/logging` 这类库包。
2. 内核代码中不再有专为 TypeScript 模块写的逻辑：不生成 TS 声明，不写 Bun preload 插件，不按 `.ts` 扩展名做特殊分支。这些都改为随发行附带的"语言运行包"中的数据和外部程序，内核只负责读取和执行。
3. 所有公开工具的 `contractHash` 都能由**提交进仓库的 JSON** 和书面算法重新算出，不依赖任何库在运行时序列化 schema 的结果。
4. **任何现有 `contractHash` 的值都不改变**。events 的订阅、notify 的渠道、web 的页面登记里都持久化了 hash（`external/events/events.ts:151`、`external/notify/notify.ts:21`、`external/web/pages.ts:159`），hash 一变，这些绑定就会全部失效。

不在本方案范围内：用其他语言重写内核；Python SDK；书面线协议规格；JSON Schema 层的兼容性比较；把 `ulimit -v` 换成 cgroup；现有数据迁移。

## 2. 现状（需要拆掉的耦合）

| # | 耦合 | 位置 |
| --- | --- | --- |
| A | 内核 import Agent 的 zod schema 来做准入和解析 | `agent-application.ts:7`（`agentInput`）、`agent-delegation.ts:9-13`（`moduleAgentInput`、`primitiveInput`、`isAgentPrimitive`）、`agent-projects.ts:5`（`projectsInput/Output`、`projectPrincipal`）、`agent-primitives.ts:8` |
| B | Agent 通过相对路径 import 宿主源码 | `builtin/agent/runtime.ts:5,6,15`（`pi-provider`、`browser`、`pi-launch`）、`builtin/agent/primitives.ts:4`（`transcript-redaction`） |
| C | 为了能对 Agent 做类型检查，内核要还原整棵宿主源码树 | `module-typecheck.ts:8-22`（`builtinTypecheckMaterial` macro、`builtinCallerMaterial`）、`module-typecheck-material.macro.ts`、`module-build.ts:225`（`builtinCaller`） |
| D | 系统工具的 hash 和发现结果由 zod 在运行时序列化得到 | `module-tool-contract.ts:15-16`、`system-apps.ts:13-14`、`tools.ts:77`、`module-build-session.ts:35`（`MANIFEST_SCHEMA`） |
| E | 内核生成 TS 声明 `calls.d.ts` | `module-contracts.ts:50-64`（`callsDeclaration`、`tsType`），调用方是 `module-typecheck.ts:49`、`module-build-session.ts:159` |
| F | 内核硬编码 TS/Bun 运行细节 | `script-sandbox.ts:31-37`（扩展名白名单、解释器表、`MALLOC_ARENA_MAX`）、`script-sandbox.ts:65-81`（`installLocalSdk` 写入 Bun preload 插件）、`module-typecheck.ts:41`（用 `.ts` 正则决定是否检查） |

已经满足、不需要改的部分：模块与内核之间的线协议（Unix socket 上的 NDJSON，`@chrona/contracts` 里的 `moduleEventSchema`、`moduleCallSchema`）；普通模块的合同来自 `module.json`，hash 由手写的规范化逻辑加上排序键的 JSON 计算（`module-tool-contract.ts:9-17,71-78`）；模块版本 hash 是 git tree hash（`module-git.ts:67`）；内核生产代码不 import 任何 `external/*` 模块；Agent 运行时已经由 `builtin/agent/build.ts` 打包成自带全部依赖的 `runtime.js`。

## 3. 阶段

每个阶段都单独提交。按 `AGENTS.md` 的要求，旧代码、旧测试、旧文档在同一次改动中删除，不保留转发 re-export，也不保留兼容别名。

### 阶段 0：锁住基线（必须最先做）

1. 新增 `packages/contracts/fixtures/contract-hashes.json`，记录**改动前**的 hash：
   - 5 个内核命名空间下所有系统工具：`target → contractHash`；
   - Agent 的全部工具；
   - 当前 `external/*/module.json` 中所有工具。
2. 新增测试：对上述每个工具重新计算 hash，必须与 fixture 完全相等。另外补几条普通模块工具的合成用例，覆盖整数和浮点数（`1`、`1.5`）、非 ASCII 字符串、嵌套 object 和 array、`enum`、`required` 的顺序、`visibility` 的顺序。这些用例就是将来其他语言内核要通过的 golden 测试。
3. 把当前 `buildAgentApplication()` 生成的 `builtin/agent/module.json` 保存为快照。后续阶段重新生成时，结果必须逐字节一致。

验收：新测试通过；本阶段不改任何生产代码。

### 阶段 1：Agent 自包含

1. **内核与 Agent 之间的合同移入合同包。** 把 `builtin/agent/contracts.ts`、`module-contracts.ts`、`project-contracts.ts`，以及 `primitives.ts` 中的**纯 schema 部分**，移到 `packages/contracts/src/steward/agent.ts`，并从 `@chrona/contracts/steward` 导出。
   - `primitives.ts` 中用到 `transcriptRedactor` 等运行时逻辑的部分留在 Agent 目录。
   - 耦合 A 的 4 个内核文件和 Agent 都改为从 `@chrona/contracts/steward` import，原文件删除。
   - 这些合同由内核持有：内核做准入时确实要读懂 `executionId`、`requestKey`、`prompt`、scope 等字段，所以合同放在合同包，不放在 Agent 目录。
2. **Pi Provider 独立成库包 `packages/pi`（`@chrona/pi`）。**
   - 移入 `pi-provider.ts`、`pi-events.ts`、`pi-launch.ts`、`pi-process.ts`、`pi-resources.ts`、`pi-session-resume.ts`、`pi-transcript.ts` 及其测试。
   - 依赖方改为 import `@chrona/pi`：Agent 的 `runtime.ts`、`integrations/src/executor/daemon.ts:6`（远端执行设备也用它）、`integrations/src/steward/pi-model-gateway.ts`、`agent-application-host.ts`，以及 `integrations/src/steward/index.ts` 的导出。
   - `pi-model-gateway.ts` 是内核侧的模型网关，留在 `integrations`。
3. **`browser.ts` 移入 Agent 目录**（只有 Agent 使用它）。
4. **`transcriptRedactor` 移入 `@chrona/logging/redaction`**（它本来就只依赖这个模块）。内核的 `transcript.ts`、`module-build-session.ts` 和 Agent 都从这里 import，删除 `integrations/src/steward/transcript-redaction.ts`。
5. **在 `.dependency-cruiser.cjs` 中新增两条禁止规则**：
   - `builtin/agent/**` 不能 import 自身目录以外的相对路径；
   - `steward/*.ts`、`steward/system/**`、`apps/server/**` 不能 import `builtin/agent/**`。

   测试文件和 fixture 也遵守这两条规则：需要组合使用的场景通过公开包或运行中的路由完成。
6. **删除耦合 C。** Agent 运行时会调用普通应用（`runtime.ts:46` 的 `settingsRegistration` 经 `chrona.call` 登记设置页），所以普通应用的合同发生变化时，依赖方检查仍然需要覆盖 Agent。
   - 删除 `builtinCallerMaterial`、`module-typecheck-material.macro.ts`。
   - Agent 作为依赖方时，按普通模块的方式检查：它的 `@chrona/*` 依赖由检查环境中的 `node_modules` 提供，不再还原宿主源码树。
   - `builtinCaller` 参数只在仍有其他用途时保留，否则一并删除。

验收：
- 阶段 0 的全部 hash 不变，`module.json` 快照逐字节一致；
- depcruise 的新规则通过，`.dependency-cruiser-known-violations.json` 中不新增例外；
- `grep -rn "builtin/agent" packages/engine/src/modules/steward/*.ts packages/engine/src/modules/steward/system apps/server/src` 没有生产代码命中；
- Agent 的 runtime、lifecycle、delegation 相关测试全部通过。

### 阶段 2：冻结系统工具合同

1. 在 `build/` 中新增生成脚本（参照 `build/execution-contracts.ts` 的写法）。脚本用现有 zod 定义生成并提交以下三个文件：
   - `packages/contracts/schemas/system-tools.json`：系统工具 `target → { input, output, visibility, idempotent }`；
   - `packages/contracts/schemas/module-wire.json`：`moduleEventMessageSchema`、`moduleCallSchema` 及其返回消息；
   - `packages/contracts/schemas/module-manifest.json`：取代 `module-build-session.ts:35` 在运行时生成的 `MANIFEST_SCHEMA`。
2. 运行时改为读取这些 JSON：
   - `module-tool-contract.ts:15-16` 计算系统工具 hash 时用冻结的 JSON，**删除运行时的 `z.toJSONSchema` 分支**；
   - `system-apps.ts:13-14`、`tools.ts:77` 返回的 `inputSchema`、`outputSchema` 同样来自这份 JSON。

   zod 仍然负责运行时校验，并保留为生成源头。
3. 新增测试：重新生成的结果必须与已提交文件一致，不一致就失败，提示运行生成脚本。
4. 在[永久内核合同](kernel-permanent-boundary-contract.md) §2 中补充 `contractHash` 的书面算法：输入是哪些字段、`parameters` 如何规范化、对象键按 UTF-16 码元排序、数组保持原顺序、数字和字符串按 ECMAScript `JSON.stringify` 的语义输出、最后取 SHA-256 十六进制。同时注明 golden 测试的位置，即阶段 0 的 fixture。

验收：阶段 0 的 hash 全部不变；`grep -rn "toJSONSchema" packages/engine/src/modules/steward --include=*.ts` 中不再出现计算 hash 和发现结果的生产路径。

### 阶段 3：TS 工具链改成语言运行包

把内核里专为 TS 写的代码改成随发行附带的数据和外部程序。将来换内核语言时，这个包可以原样保留，不需要重写。

1. **调用合同改为语言无关的格式。**
   - 删除 `callsDeclaration` 和 `tsType`。内核改为写出 `calls.json`，内容是 `[{ target, input, output }]`，筛选规则保持现状：`visibility` 包含 `modules` 或 `owner`。
   - `module-typecheck/` 中新增 `calls.ts`，负责把 `calls.json` 转成 `calls.d.ts`。`check.ts` 在检查之前先调用它。
   - AI 构建会话（`module-build-helpers.ts`、`module-build-session.ts:159`）同样只写 `calls.json`，由运行包的脚本生成 `.d.ts`。只读权限、文件位置和构建者看到的 `node_modules/chrona/calls.d.ts` 保持不变。
2. **运行时表改成数据。**
   - 新增 `packages/integrations/src/steward/runtimes.json`，按入口扩展名声明：解释器名称、argv 模板、额外环境变量（Bun 的 `MALLOC_ARENA_MAX=2`）、SDK 目录、非隔离模式下的 preload 文件、可选的 `check` 命令。
   - `script-sandbox.ts` 改为读取这张表，替代第 31-37 行的白名单和解释器表。
   - `installLocalSdk` 写入的 Bun 插件改为运行包中的一个静态文件 `module-sdk/chrona-sdk-loader.ts`，内核只负责复制。
   - 现有的 `.ts/.py/.sh` 行为、入口名正则、`--no-install`、Python venv 优先这些规则全部保持不变。
3. **类型检查改为"运行时声明了 `check` 才执行"。** `module-typecheck.ts:41-42` 不再匹配 `.ts`，改为：表中没有 `check` 时返回 `skipped`，有就执行。Python 和 Shell 模块的行为与现在相同。

验收：
- `grep -rnE "\\.ts\\b|bun" packages/engine/src/modules/steward/module-typecheck.ts packages/engine/src/modules/steward/module-contracts.ts` 中不再出现与语言相关的分支；
- 构建会话测试、类型检查测试、依赖方检查测试、`script-sandbox` 测试全部通过；
- 用一个 `.py` 入口的模块完成一次安装和启动（新增测试）。

## 4. 检查与验收

- 按[资源约束](../../AGENTS.md)**串行**执行 `typecheck`、`lint`（含 depcruise 和 ratchet）、`test:bun`、`test:api`，每项都在带 `MemoryMax` 上限的 systemd-run 中运行，不并行。
- 端到端回放：在全新的数据目录里启动实例，完成以下操作：
  1. 一次 Agent 运行（对话中的普通请求和一次 Coding 项目工作）；
  2. 一次 owner 发起的受控构建，生成新应用、通过类型检查并激活；
  3. 用 events 订阅、notify 渠道、web 页面登记各验证一次 hash 绑定，结果均为有效；
  4. 按 [steward-goals](steward-goals.md) §8 的场景回放，并保存页面截图。

  绿色 CI 不能替代这一步。
- 每个阶段结束时在本文追加一行状态，说明实际运行的命令和结果；未运行的项要如实写明。

## 5. 风险

- **hash 漂移**：任何阶段只要改变了现有 hash，就会让已持久化的绑定失效。阶段 0 的 fixture 是硬门禁；出现差异时修代码，不更新 fixture。
- **Agent 打包产物变化**：阶段 1 移动 import 路径之后，`runtime.js` 会变，Agent 的版本 hash 也随之变化。这是正常的发行行为，但要确认启动时内置 Agent 的身份识别依据的是持久化的 `Module.builtin` 和当前批准版本，而不是旧 hash。
- **远端执行设备**：`executor/daemon.ts` 改为依赖 `@chrona/pi`，发布打包（`build/manifest.ts`、`build/portable-elf.ts`）要包含这个新包。用 `release-smoke` 验证。
