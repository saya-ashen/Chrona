# 内核可移植、可信本地运行与远程执行应用化实施方案

日期：2026-11-09。状态：**方案，尚未实施或验收**。

本文由两份方案合并而成：一份是《内核语言无关化实施方案》（提交 `38310f75`，已删除），另一份是《可信本地跨平台运行与远程执行应用化方案》（已归档至 [history](history/cross-platform-runtime-and-remote-execution-plan.md)）。两者都在改造内核，而且会改到同一批文件，因此合并为同一条实施路线。

当前授权范围只是编写方案，不包括运行时改造、部署、真实设备配对、模型调用或迁移现有用户数据。文中的源码位置对应当日 `platform-v2` 工作区，行号只用于定位；macOS 和 Windows 尚未实际运行验证。

## 1. 目标与决策

### 1.1 三个目标

1. **语言可移植**：以后如果把**内核和内置 Agent 应用一起**换成别的语言（例如 Rust）重写，所有普通应用不改代码，已有的持久绑定也不失效。Agent 同时改成自包含模块：内核与 Agent 之间只通过合同包和库包协作，不再互相 import 实现代码。
2. **跨平台可信本地运行**：核心服务和本地应用在 Linux、macOS、Windows 上都能原生运行。去掉强隔离，运行模型改为可信本地执行。
3. **远程执行应用化**：保留"把任务交给另一台设备，在该设备获准的项目目录内执行并回传结果"的能力，改为"可选普通应用 + 设备端程序 + 最小通用内核支撑"，不再整套固化在内核中。

### 1.2 已确定的方向

- 删除 bwrap 强隔离，不建设各平台对应的隔离后端。
- 删除硬虚拟内存限制（`ulimit -v`）和强制 Shell 包装；Shell 模块改为可选能力。
- 从核心运行链路中移除 Nix 自动供应和浏览器自动下载；外部 tar 和 Unix 专用通信改用三端可用的实现。
- 内核中不再保留专为 TypeScript 写的逻辑：TS 工具链改为随发行附带的运行包（数据加外部程序）。
- 系统工具合同冻结为提交进仓库的 JSON；`contractHash` 有书面算法和 golden 测试。

### 1.3 非目标

- 不提供针对不可信应用恶意代码的隔离；不把 Manifest、路由授权或凭据过滤描述成操作系统级隔离。
- 不用其他语言重写内核；不做 Python SDK、书面线协议规格或 JSON Schema 层的兼容性比较。
- 不扩展成通用远程模块宿主、任意插件分发或任意远程命令服务。
- 不新增第二条 Run 队列、第二套 Coding 业务语义，或新的不可变内置应用（`@chrona/pi` 是库包，不是应用）。
- 不因为移除隔离而删除身份、授权、预算、取消、停止证据、备份或受控生命周期。
- 不迁移现有用户数据，不承诺兼容旧协议。

### 1.4 全程适用的硬约束

1. **合同 hash 稳定。** events 的订阅、notify 的渠道、web 的页面登记都持久化了 `contractHash`（`external/events/events.ts:151`、`external/notify/notify.ts:21`、`external/web/pages.ts:159`）。除了本方案明确列出要删除或修改的工具，任何工具的 hash 都不能改变。被修改的工具要在提交说明中逐项列出原因；遇到计划外的差异，修代码，不改 fixture。
2. **跨进程边界语言中立。** 新增或修改的跨进程接口（模块传输、远程执行应用与内核之间的私有接口、设备协议）都必须能用任何语言实现：使用路由调用、JSON 合同、标准传输，不依赖 Bun 特有能力，也不 import TS 实现。进程如何获得连接信息（目前是 `CHRONA_SOCKET`、`CHRONA_HTTP_SOCKET`）属于合同的一部分。
3. **必须保留**：真实 caller、精确授权、凭据处理与日志脱敏、模型预算、单 Run 队列、租约、超时、输出与并发上限、取消、实际停止状态、持久化、备份恢复和受控应用生命周期。
4. 按 `AGENTS.md`，被替代的代码、测试、文档和合同字段在同一次改动中删除，不保留转发 re-export 或兼容别名。

## 2. 当前源码基线

| 范围 | 当前实现 | 主要定位 |
| --- | --- | --- |
| 内核 import Agent 的 schema | 准入和解析时直接使用 Agent 的 zod | `agent-application.ts:7`、`agent-delegation.ts:9-13`、`agent-projects.ts:5`、`agent-primitives.ts:8` |
| Agent import 宿主源码 | 通过相对路径引用 Pi、browser、脱敏工具 | `builtin/agent/runtime.ts:5,6,15`、`builtin/agent/primitives.ts:4` |
| 为 Agent 还原源码树 | 用 macro 还原宿主源码树，供类型检查 | `module-typecheck.ts:8-22`、`module-typecheck-material.macro.ts`、`module-build.ts:225` |
| 系统工具 hash | 运行时执行 `z.toJSONSchema` | `module-tool-contract.ts:15-16`、`system-apps.ts:13-14`、`tools.ts:77`、`module-build-session.ts:35` |
| TS 声明生成 | 内核生成 `calls.d.ts` | `module-contracts.ts:50-64`、`module-typecheck.ts:49`、`module-build-session.ts:159` |
| 隔离模式 | 默认 trusted-local；required-isolation 使用 bwrap，并在不可用时拒绝运行 | `module-runtime.ts`、`script-sandbox.ts`、`pi-launch.ts` |
| 模块启动 | TS/Python/Shell 都经 `sh` 加 `ulimit -v` 启动；按扩展名查解释器；Bun 专用的 `MALLOC_ARENA_MAX`；写入 Bun preload 插件 | `script-sandbox.ts:31-37,65-81` |
| TS 检查 | 内核用 `sh` 加 `ulimit` 启动 `check.ts`；用 `.ts` 正则决定是否执行 | `module-typecheck.ts:41-50` |
| 进程清理 | detached 进程组，用负 PID 发 SIGKILL | `script-sandbox.ts`、`module-sdk/sdk.ts` |
| IPC 与 HTTP | 文件路径 socket、`isSocket` 检查；Bun unix serve/fetch | `module-channel.ts`、`module-supervisor.ts`、`module-sdk/sdk.ts`、`apps/server/src/app.ts` |
| 目录与解释器 | 硬编码 `/tmp`、冒号分隔的 PATH、`.venv/bin/python` | `module-supervisor.ts`、`module-build-process.ts`、`script-sandbox.ts`、`module-sdk/testing.ts` |
| 系统工具供应 | Nix 后端或检查宿主程序 | `module-packages.ts` |
| 浏览器供应 | Nix 和固定下载（仅 linux-x64） | `integrations/src/steward/browser.ts` |
| 备份 | 调用外部 tar；恢复时用受限的 ustar 解析 | `packages/db/src/sqlite-backup-files.ts` |
| 独立 Executor | 依赖 Linux、systemd 262、flock、`/proc`、cgroup v2；与 Agent 共用 Pi Provider | `packages/cli/src/executor-*.ts`、`integrations/src/executor/process.ts`、`integrations/src/executor/daemon.ts:6` |
| 设备与内核耦合 | 路由、认领、授权代次和远程完成路径直接认识 Executor 协议；Agent 原语带有 `placement` | `apps/server/src/executor-router.ts`、`execution-device-runtime.ts`、`execution-claim.ts`、`runs.ts`、`builtin/agent/primitives.ts:20,26` |

已经满足、不需要改的部分：模块线消息格式（`@chrona/contracts` 中的 `moduleEventSchema`、`moduleCallSchema`）；普通模块的合同来自 `module.json`，hash 由手写规范化逻辑加排序键 JSON 计算（`module-tool-contract.ts:9-17,71-78`）；模块版本 hash 是 git tree hash；内核生产代码不 import 任何 `external/*`；Agent 运行时已经打包成 `runtime.js`。`packages/integrations/src/executor` 中有一部分代码服务器本地执行也在用（工作目录准备与清理），不能整体删除。

## 3. 删减与保留清单

| 项目 | 目标处理 | 必须同步处理的行为 |
| --- | --- | --- |
| bwrap 和强隔离 | 删除隔离挂载、探测、模式分支和相关启动配置 | 删除 required-isolation 的能力承诺；同步 Pi、Agent 打包产物、健康检查、测试、文档和发行资源 |
| 旧隔离配置 | 对已设置的 required-isolation 等旧配置明确报错，并给出移除说明 | 不能把曾要求隔离的配置静默当作可信本地执行 |
| `ulimit -v`、`MALLOC_ARENA_MAX` | 删除硬虚拟内存限制、Shell 包装，以及只为配合它而存在的 Bun 环境变量 | 删除 `virtualMemoryMb` 等字段（包括 Agent manifest 的 `limits`），旧字段给出明确的校验结果；硬内存限制不能和模型预算混为一谈 |
| TS/Python 强制 sh | 直接启动解释器 | `.sh` 入口只在有 Shell 时运行 |
| 解释器表和 preload | 改为运行时表 `runtimes.json` 中的数据（见 §7.1） | 内核不再写 TS 专用代码 |
| `calls.d.ts` 生成 | 内核只写出 `calls.json`，`.d.ts` 由 TS 运行包生成 | 构建者看到的 `node_modules/chrona/calls.d.ts`、只读权限和位置都不变 |
| Nix 自动供应 | 从核心安装和运行路径移除 | 系统程序按需检测，缺失时报告；保留语言锁文件的安装流程；先盘点 GC root 和自动安装的调用方 |
| 浏览器自动下载 | 删除 Nix 和固定下载流程 | 改用显式配置或宿主已安装的浏览器；没有浏览器只影响依赖它的功能 |
| 开发辅助 `.sh` | 改为 Bun/TS 入口（包括 `module-build-helpers.ts` 写出的 `typecheck.sh`） | 候选检查、离线测试和超时保持不变 |
| 外部 tar | 改为进程内实现 | 保持私有权限、路径校验、普通文件限制和备份恢复闭环 |
| Unix 专用通信 | 改为三端验证过、语言中立的传输方式 | 保持身份绑定、请求边界、取消、断连、HTTP 路由和生命周期行为 |
| `/tmp`、PATH、venv | 改用平台目录和路径规则 | 覆盖测试 SDK、构建、预览、Python 环境和发行资源 |
| systemd/cgroup/flock | 从核心必需依赖中剥离 | 可以保留为 Linux 设备端后端；其他平台的缺失能力必须显式报告 |

移除强隔离后，应用可以使用运行账号拥有的全部宿主权限。不能再承诺凭据过滤能阻止可信进程自行读取该账号可访问的文件，安装和运行说明都要符合这一信任模型。

## 4. 内核与 Agent 的边界

- 内核与 Agent 之间的合同（Agent 的输入输出、原语、项目操作）放在 `@chrona/contracts`，由内核持有。原因是内核做准入时确实需要读懂 `executionId`、`requestKey`、`prompt`、scope 等字段。
- Pi Provider 拆成库包 `@chrona/pi`，供 Agent 和设备端程序共用。`pi-model-gateway.ts` 是内核侧的模型网关，留在 `integrations`。
- Agent 只能 import：自身目录、`chrona` SDK、`@chrona/contracts`、`@chrona/pi`、`@chrona/logging`、第三方包。内核不 import `builtin/agent/**`。这两条用 depcruise 规则强制。
- Agent 运行时会调用普通应用（`runtime.ts:46` 的 `settingsRegistration`），所以普通应用的合同发生变化时，依赖方检查仍要覆盖 Agent。检查方式与普通模块相同，它的 `@chrona/*` 依赖由检查环境的 `node_modules` 提供。

## 5. 远程执行目标架构

普通应用暂定名为 `remote-execution`，最终名称在合同定稿时确定。它可以作为可选安装包或默认预装包交付，预装不增加任何权限。Agent 仍是唯一不可变的内置应用。

```mermaid
flowchart LR
    C[Coding 等业务应用] --> A[Agent 执行入口]
    A --> K[内核通用准入与 Run 治理]
    K --> R[远程执行应用]
    R <-->|设备专用认证与协议| E[设备端 Executor]
    E --> P[设备上的 Pi 与项目目录]
    R -->|进度、结果、停止报告| K
    K -->|受控结果| A
    A --> C
```

图中的连线表示目标职责和控制路径，不代表已存在的 API。实现时优先复用现有的 Agent 和应用路由，不引入公共 Provider 注册框架，也不开放"任意应用都能写 Run 状态"的接口。

### 5.1 职责归属

| 主体 | 拥有的职责 | 不应承担的职责 |
| --- | --- | --- |
| Coding | 项目业务选择、会话、轮次、用户指令、结果与 UI 语义 | 设备协议、进程监管、另建执行队列 |
| Agent | 统一执行入口、与 Pi 适配协作、面向调用方的受控执行与控制接口 | 设备配对 UI、设备目录管理业务 |
| 远程执行应用 | 配对、设备凭据、项目映射、在线观察、协议分发、去重、命令与结果收据、重连核对、应用私有的设备状态 | 自行授予内核 caller 权限、伪造停止证明、绕过预算、重连时擅自启动旧任务 |
| 设备端程序（依赖 `@chrona/pi`，独立打包） | 本机工作目录、启动 Pi、进程监管、资源能力、事件缓存、取消、状态核对与停止证据采集 | 决定内核权限、在没有有效任务授权时自动续跑 |
| 内核及必要的私有宿主 | 真实身份、调用授权、共享预算、单 Run 队列、占用、取消与生命周期；在明确的可信边界接收执行结果 | 固化配对协议、设备发现、项目映射格式、systemd 专用规则或 Coding 策略 |

### 5.2 设备端始终存在

服务器上的普通应用无法直接访问另一台设备的文件和进程，所以远程设备仍要运行执行程序，可以独立安装，也可以随发行包提供。停用远程应用后，核心的本地执行照常可用；不配置设备端不会阻止核心启动。设备端保持独立程序形态，不要求每台设备安装完整的 Chrona，也不扩展成通用远程应用宿主。

### 5.3 认证与通信

- 普通用户访问应用沿用现有的 owner/API 鉴权。设备只使用设备专用凭据，不能持有或继承 owner 的全局 API key。
- 现有设备路由有专用的认证语义，不能机械地挪到要求 owner key 的 `/api/<app>` 代理后面。实施前必须先确定凭据验证、入口代理、撤销和应用生命周期如何配合。
- 优先让应用自己持有设备认证处理和协议。如果现有 HTTP 入口承载不了，只增加解决这个认证边界所必需的窄宿主适配，不开放通用的免鉴权路由。
- 设备端主动连接、轮询还是保持长连接，由协议设计决定；传输中断不构成停止证据。跨设备传输必须明确配置传输保护，不能默认明文跨网是安全的。
- 内核交给应用的任务授权必须绑定真实调用方、具体任务、目标、预算和有效期；应用不能通过参数换成任意 cwd，也不能冒充另一个调用者。
- 远程执行应用与内核之间的私有接口（§6）也是路由调用，合同用冻结的 JSON 表达，见 §1.4 第 2 条。

### 5.4 应用私有状态与内核状态

设备、项目映射、协议代次、序列号、传输缓存和应用业务收据迁入应用私有存储。共享 Run 的准入、预算预留、取消、占用和最终状态留在内核。

两者分属不同进程后，不能再依赖同一个数据库写事务。迁移时必须设计固定的请求 key、持久化的交付记录、接收收据和重启后的核对；响应丢失时先查已有收据，不用新 key 重新启动同一个任务。不能因为"业务迁出"而丢掉现有的重复执行防护。

## 6. 必须先定稿的通用执行边界

目前认领路径直接读取设备表、核对授权代次并准备远程 assignment，停止恢复路径也直接区分 server 和 device。这些耦合要按具体场景收缩，不能只是把代码挪到应用目录。实施前需要给出以下最小合同和故障状态表：

1. **准入与交付**：一个获准的 Run 如何绑定远程目标；应用接收了任务不等于设备已经启动；哪一条持久化记录负责防止重复启动。
2. **事件与结果**：进度和结果如何绑定 task/run/attempt、应用身份和执行代次；如何拒绝伪造、迟到或重复的报告。
3. **预算与执行约束**：内核预留的模型预算如何约束设备端的实际执行。只靠最终回传的 usage，不足以证明硬预算真的被执行了。
4. **停止证据**：设备后端采集什么，由哪一个可信适配边界验证并接受。普通应用报告的 `stopped: true` 不是充分证据；平台无法提供所需证据时，必须暴露 unsupported/unknown，不能伪装成 confirmed。
5. **应用生命周期**：暂停、更新、删除应用时，如何撤销新任务的授权、处理已在运行的任务、保留恢复记录。
6. **身份变化**：应用版本、设备配对代次或运行实例变化后，如何拒绝旧授权、如何核对已有任务。

这些接口优先保持私有、窄、基于现有 Run 机制，不增加公共内核命名空间。Agent 原语里的 `placement` 等远程相关字段按这里的合同调整，调整后的工具按 §1.4 第 1 条列出。如果无法保持现有的预算或停止语义，先记录具体缺口并解决，不能宣称拆分完成。

## 7. 本地运行设计

### 7.1 运行时表与启动

`packages/integrations/src/steward/runtimes.json` 按入口扩展名声明以下内容：

- 解释器名称和各平台的解释器布局（例如 venv 在 POSIX 下是 `bin/python`，在 Windows 下是 `Scripts\python.exe`）；
- argv 模板（例如 TS 的 `--no-install`）；
- 额外环境变量；
- SDK 目录；
- preload 文件（Bun 的 SDK 解析插件作为静态文件 `module-sdk/chrona-sdk-loader.ts` 存放在运行包里，内核只负责复制）；
- 可选的 `check` 命令。

`script-sandbox.ts` 和 `module-typecheck.ts` 只读取这张表，直接启动解释器，不再经过 `sh` 或 `ulimit`。表里没有声明 `check` 时，类型检查返回 `skipped`。入口名正则、Python venv 优先的规则保持不变；`.sh` 只在宿主有 Shell 时可用。以后换语言重写内核，可以继续读取同一张表和同一个 TS 运行包。

需要统一实现的行为：启动、超时、取消、进程树清理、退出观察和能力报告。各平台的实现可以不同，但不能把直接子进程退出当作整个任务树已经停止。Linux 设备端可以保留 systemd 后端；Windows Job Objects 和 macOS 的进程监管方案作为候选，需要分别验证与 Bun 的集成、子进程逃逸和父进程异常退出时的行为，本文不承诺已有可用实现。普通本地运行不要求 systemd 262。

删除硬内存限制之后，健康检查和配置不能再声称有这项限制。模型 token 预算、工具调用上限、运行时限、输出上限和并发上限继续各自执行。

### 7.2 本地 IPC 与 HTTP

候选方案是各平台的本地 IPC，或者只监听 loopback 的连接。以三端实际支持情况和最小改动为依据定稿，并满足 §1.4 第 2 条：不依赖 Bun 特有的 unix serve/fetch，连接方式通过环境变量合同告诉模块进程。

如果改用 loopback，需要：每个实例一个不可猜测的凭据、绑定到目标实例、启动时的就绪握手、限制监听地址、限制消息大小、处理断连。不能仅凭"来自本机"就授予 caller 身份；内部凭据不能注入到应用自报的 caller 中，也不能写进日志。新增的握手消息纳入 wire schema。

模块 HTTP 继续经过现有的受控路由和代理，内部监听端点不能成为绕过鉴权的公开入口。预览、构建启动检查、SDK testing 和生产运行必须使用同一份合同。

### 7.3 路径、工具与备份

使用 `os.tmpdir`、`path.delimiter` 和平台的解释器布局。依赖按功能检测：TS 应用不会因为缺少 Python、Shell、浏览器或 Nix 而不可用。进程内实现的备份优先沿用现有的受限 ustar 读取合同，覆盖普通目录、文件、空目录、长路径边界、恶意路径和特殊文件；不能因为跨平台而放松恢复时的路径校验或私有存储要求。

## 8. 合同冻结

1. **基线 fixture**：`packages/contracts/fixtures/contract-hashes.json` 记录**改动前**以下工具的 `target → contractHash`：5 个内核命名空间下的全部系统工具、Agent 的全部工具、`external/*/module.json` 中的全部工具。另加几条合成用例，覆盖整数和浮点数、非 ASCII 字符、嵌套 object/array、`enum`、`required` 顺序、`visibility` 顺序。这组用例也是将来其他语言内核要通过的 golden 测试。Agent 的 `module.json` 中 tools 部分另存一份快照。
2. **冻结的 JSON**：`build/` 中的生成脚本（参照 `build/execution-contracts.ts` 的写法）用 zod 生成以下文件并提交：
   - `packages/contracts/schemas/system-tools.json`：`target → { input, output, visibility, idempotent }`；
   - `module-manifest.json`：取代运行时生成的 `MANIFEST_SCHEMA`；
   - `module-wire.json`：模块线消息，包括 §7.2 新增的握手。

   运行时的 hash 计算和工具发现结果都读取这些 JSON，删除运行时的 `z.toJSONSchema` 分支。zod 继续负责运行时校验，并作为生成源头。测试要求重新生成的结果与已提交文件一致。
3. **书面算法**：在[永久内核合同](kernel-permanent-boundary-contract.md) §2 补充 `contractHash` 的计算方法：输入哪些字段、`parameters` 如何规范化、对象键按 UTF-16 码元排序、数组保持原顺序、按 ECMAScript `JSON.stringify` 的语义输出、取 SHA-256 十六进制。同时注明 golden 测试的位置。

## 9. 故障与生命周期规则（远程）

| 情况 | 必须发生的行为 |
| --- | --- |
| 设备离线且任务未交付 | 继续排队，或在队列有效期结束时终止；不在其他设备上自动执行 |
| 已启动的设备断连 | 状态为无法确认；保留占用，不从断连推断已停止 |
| 取消响应丢失 | 查询固定的命令收据；停止未确认时不释放占用 |
| 应用进程重启 | 恢复协议状态并核对任务，不重新启动已被接收的 attempt |
| 设备端重启 | 先核对遗留任务和进程身份，再接受新任务；恢复不等于自动续跑 |
| 设备撤销或授权到期 | 阻止新的启动和敏感操作，正在运行的任务进入取消和核对流程 |
| 应用暂停或卸载 | 禁止新的分发；先停止并核对已有的远程工作。无法确认时，不能声称卸载完成，也不能删除唯一的恢复材料 |
| 旧实例回传结果 | 校验任务绑定、代次和收据，拒绝越权覆盖；保留可核对的证据 |
| 结果已接收但确认丢失 | 重传时返回同一个固定结果，不重复记账，也不重复执行 |

状态未知时不做无限制的自动重试，也不假设远程系统提供恰好一次执行。用保留的证据、固定 key 和保守的占用来控制不确定性。

## 10. 实施阶段

每个阶段单独提交。阶段之间的先后顺序是由"共用文件"和"依赖关系"决定的，不能调换。

### S0：基线与合同草案

- 按 §8 第 1 条建立 hash fixture 和 Agent tools 快照（只加测试，不改生产代码）。
- 固定要移除的模式、配置、Manifest 字段、发行资源及其调用方清单。
- 完成 §6 远程执行的授权、预算、状态、收据、认证入口和生命周期设计，以及 §9 的故障状态表。
- 确定本地和设备端在各平台上验证停止能力的办法。
- 交付：fixture 测试、合同草案、故障状态表、源码影响表和可执行的验收用例清单。尚未定稿的项不能用空适配器掩盖。

### S1：可信本地运行与 TS 工具链改为运行包

这两部分共用 `script-sandbox.ts`、`module-typecheck.ts`、`module-build-helpers.ts`，所以一起完成。

- 移除 bwrap/required-isolation、`ulimit -v`、`MALLOC_ARENA_MAX`、强制 Shell；处理旧配置和 `virtualMemoryMb` 字段（§3）。
- 引入 `runtimes.json`，类型检查改为由运行时声明（§7.1）。
- 删除 `callsDeclaration`、`tsType`；内核写出 `calls.json`，`module-typecheck/` 新增 `calls.ts` 负责生成 `.d.ts`，`check.ts` 和构建会话都调用它。
- 收缩 Nix 和浏览器自动获取（**在 S2 移动 `browser.ts` 之前完成**），移除 `pi-launch.ts` 中的 bwrap（**在 S2 移动 `pi-launch.ts` 之前完成**），开发辅助 `.sh` 改成 TS。
- 修复路径、解释器和环境变量的构造；完成进程内备份。
- 同步 Agent 生成产物、资源、配置、doctor/health、`AGENTS.md` 和运维说明。
- 交付：本地功能的行为验证；增加一个 `.py` 入口模块完成安装和启动的测试。hash fixture 全部不变。此阶段不据此宣布三端完整支持。

### S2：Agent 自包含

- 内核与 Agent 之间的 schema 移入 `packages/contracts/src/steward/agent.ts`。`primitives.ts` 中的运行时逻辑留在 Agent，纯 schema 部分迁出。耦合的 4 个内核文件改为从合同包 import，原文件删除。
- 新建 `packages/pi`（`@chrona/pi`），移入 `pi-provider`、`pi-events`、`pi-launch`、`pi-process`、`pi-resources`、`pi-session-resume`、`pi-transcript` 及其测试；改 Agent 的 `runtime.ts`、`executor/daemon.ts`、`pi-model-gateway.ts`、`agent-application-host.ts` 和 `integrations` 的导出，让它们改从 `@chrona/pi` import。
- `browser.ts` 移入 Agent 目录；`transcriptRedactor` 移入 `@chrona/logging/redaction`，同时修改 `transcript.ts`、`module-build-session.ts` 的 import。
- 删除 `builtinCallerMaterial` 和 `module-typecheck-material.macro.ts`；Agent 作为依赖方，按 §4 的方式检查。
- 在 `.dependency-cruiser.cjs` 中加入 §4 的两条禁止规则，测试和 fixture 也遵守。
- 发布打包（`build/manifest.ts`、`build/portable-elf.ts`）纳入 `@chrona/pi`。
- 交付：hash fixture 不变，Agent tools 快照一致；depcruise 不新增例外；在内核目录中 `grep builtin/agent` 没有生产代码命中；`release-smoke` 通过。

### S3：冻结系统工具合同

- 按 §8 第 2、3 条生成并提交 `system-tools.json`、`module-manifest.json`（此时 `virtualMemoryMb` 已经删除），运行时改为读取这些文件，并写出书面算法。
- 交付：hash fixture 不变；`grep toJSONSchema` 中不再出现计算 hash 和工具发现结果的生产路径。

### S4：本地通信与进程监管跨平台

- 按 §7.2 完成 IPC、HTTP、预览、测试 SDK 和构建检查的一致实现；SDK 的 `serve` 不再依赖 Bun unix serve；生成 `module-wire.json`（包括握手消息）。
- 完成各平台的进程清理、取消和异常退出处理。
- 交付：三端本地验收矩阵和未支持能力说明。

### S5：远程应用与设备端拆分

- 先抽出服务器和设备端共用的工作目录准备、锁定和清理代码，保留本地 Coding。
- 设备协议、凭据、配对、映射和业务记录迁入普通应用，提供必要的设备认证入口（§5.3）。
- 改造内核中直接认识 Executor 的认领、路由、恢复和完成路径，只保留最小的可信执行支撑。按 §6 调整 Agent 原语，hash 变化逐项列出。
- 设备端程序依赖 `@chrona/pi`，独立打包；Linux 监管后端与核心解耦。
- 交付：四种组合的验证证据——无远程应用的核心、本地 Coding、已安装远程应用、实际设备端。

### S6：三端远程验收与旧链路清理

- 覆盖三端设备上的执行、断连、取消、重启、撤销和应用更新/卸载。
- 删除被替代的设备专用内核协议、直接数据库耦合、配置和打包残留。
- 发布矩阵分别列出服务端和设备端的支持情况。
- 交付：准确的命令、修订、平台、通过项、失败项和限制；不用历史 smoke 代替本轮验收。

## 11. 验收标准

### 11.1 语言可移植

- 内核（`steward/*.ts`、`steward/system/`、`apps/server`）不 import `builtin/agent/**`；Agent 不通过相对路径越出自身目录；depcruise 强制这两条。
- 内核中没有 TS 专用逻辑：不生成 TS 声明，不写 Bun 插件，不按 `.ts` 分支。
- 所有公开工具的 `contractHash` 都能由已提交的 JSON 加上书面算法重新计算得到，并通过 golden 测试；除了明确列出的变更外，fixture 不变。
- 远程执行应用与内核、设备之间的接口都是语言中立的路由调用或协议。

### 11.2 核心与本地应用

- 核心启动、本地 TS 应用和本地 Coding 不依赖 bwrap、systemd、flock、Nix、外部 tar 或 sh。
- Python、Shell、浏览器只在相应功能使用时才检测；缺少可选组件不影响其他功能。
- 模块安装、候选检查、启动、调用、HTTP、预览、停止、更新和服务重启在三端验证通过。
- 超时、取消、产生子进程后取消、父进程异常退出，都有真实进程行为的证据。
- 备份恢复往返以及路径和权限边界通过；所有自动化验证都使用临时数据。

### 11.3 远程执行

- 没有远程应用时本地功能正常，内核启动不探测设备监管工具。
- 设备端没有 owner key；配对、撤销、项目目录授权和原 caller 绑定都正确。
- 任务、命令和最终结果在响应丢失、消息重复、乱序或来自旧代次时，都不会触发重复执行或覆盖。
- 设备断连、应用重启、设备重启、服务端重启之后都先核对，不把未知的停止状态标记为成功。
- 预算不能只靠最终自报；实际执行路径上有约束证据。
- 应用更新、暂停和删除不会留下被误认为已停止的远程任务，也不会删除其唯一的恢复记录。
- Coding 和其他业务调用方继续共用同一条 Run 队列和授权边界。

### 11.4 检查方式

- 按 `AGENTS.md` **串行**执行 `typecheck`、`lint`（含 depcruise 和 ratchet）、`test:bun`、`test:api`，每项都在带 `MemoryMax` 上限的 systemd-run 中运行。
- 端到端回放：在全新数据目录中完成一次 Agent 运行（普通对话请求和一次 Coding 项目工作）、一次 owner 发起的受控构建（生成、检查、激活）、events/notify/web 三类 hash 绑定各一次，并按 [steward-goals](steward-goals.md) §8 场景回放、保存截图。绿色 CI 不能替代这一步。
- 开发阶段先用临时数据库、假设备传输和真实本地测试进程覆盖故障场景。真实设备、模型、账号和部署验收需要另行明确范围，本方案不授予这些操作权限。
- 每个阶段结束时在本文追加一行状态，写明实际运行的命令和结果；没有运行的项要如实写明。

## 12. 主要待验证事项

| 事项 | 定稿依据 |
| --- | --- |
| 设备 HTTP 如何穿过现有代理 | 设备专用认证与 owner API key 分离，且不新增宽泛的鉴权例外 |
| 通用 Run 交付与应用私有记录的一致性 | 响应丢失、崩溃点、重复认领和生命周期故障用例 |
| 停止证据的可信适配边界 | 各平台的真实进程实验；普通应用不能随意提交可信的停止结论 |
| 设备端模型预算的执行 | 准入与执行点约束的闭环验证，不能只验证结果累计 |
| Windows/macOS 进程监管 | 与 Bun 的集成、进程树清理、异常退出和恢复证据 |
| 最终 IPC 实现 | 三端运行、身份与代理边界验收、语言中立 |
| 默认预装与设备端分发方式 | 不增加权限，不强制运行设备端，不影响核心离线启动 |
| `@chrona/pi` 在设备端的打包 | 设备端程序的独立构建和 smoke 通过 |

## 13. 相关文档

- [内核永久边界合同](kernel-permanent-boundary-contract.md)、[实施记录](kernel-permanent-boundary-implementation.md)：当前内核职责与应用生命周期的基线。
- [当前架构](architecture.md)、[模块依赖方向](module-dependency-direction.md)：依赖与所有权规则。
- [Coding 客户端协议](coding-peer-clients-protocol.md)：业务调用面；不借远程拆分重建 Coding 协议。
- [统一模块协议与本地／远端宿主](unified-module-runtime-plan.md)：历史与阶段背景；本文不重启已推迟的通用远程宿主工作。
- [归档：可信本地跨平台运行与远程执行应用化方案](history/cross-platform-runtime-and-remote-execution-plan.md)：合并前的原文。
