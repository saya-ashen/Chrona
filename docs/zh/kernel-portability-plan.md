# 内核可移植、可信本地运行与远程执行应用化实施方案

> 当前状态：Coding 与 coding-web 已退役，包含旧 work-v2；当前 Chat 独立拥有会话与执行记录。本文的 Coding/Editor 接口、源码路径、验收和部署描述仅作历史记录，不是现行接入指引。详见[Coding 退役说明](coding-retirement.md)。

日期：2026-11-09。状态：**S0–S3 已实施；S4 部分实现，原生平台矩阵未验收；S5 本机实际设备全链路与可靠性修复定向通过，仍为部分完成；S6 未验收**。

主分支 `f964e4dd` 已与实现提交 `442223ee` 完成语义合并；合并后 23 文件 / 278 项定向检查、全部 server/API 19 文件 / 104 项、边界检查及新编译 Linux CLI runtime smoke 通过。详细范围、lint 双父比较与历史失败见[验证记录的合并复核](kernel-portability-verification.md#合并复核2026-11-09-1918-0800)。以下实施快照核对至当日 **18:36（+08:00）**。物理存储改动后 root tsc final9、root lint final6 PASS（440 files、0 errors、1 个既有 doctor warning）、边界 final3 PASS（0 errors / 35 warnings、798 modules / 4175 dependencies）；schema `--check`、原始 hash 基线 9 pass / 147 断言、schema 生成测试 7 pass / 43 断言通过。新增有限物理存储、私有 journal 和设备回归 **7 文件 / 50 pass / 441 断言，无失败、无跳过**，包含真实 Pi 1.5.0、生产 HTTP、内核模型预留、签名停止及 cleanup。普通应用和设备均使用有限 SQLite 页数、实际证据预留与有界 DELETE 回滚日志；达到高水位后拒绝普通准入，保留终止/控制回执写入空间。安全归档与超过 100 项设备 journal 的持续恢复尚未完成。

完整 API 曾通过 105 项 / 19 文件；第三轮 full Bun 在物理存储改动前结束 229 文件，最终文件结果为 2450 pass / 38 skip，包含 notify 首次失败后隔离重试通过，**不能称为无重试全绿**；持久化等待修复后定向回归 17 pass / 0 fail。helper 路径与 ELF RPATH/RUNPATH 泄漏已修复，18 项发行回归通过；17:55 默认 Linux CLI 经离线缓存、frozen lockfile、禁用安装脚本完成迁移/health/Web runtime smoke。包含最终物理存储改动的 14 seeds、核心和独立设备包已刷新，默认 Linux runtime、可选应用实际安装及复制设备 smoke 再次通过；883 个源码文件 sourceguard 与 archive 比对通过。分次结果及失败历史见[验证记录](kernel-portability-verification.md)。所有结果限本地，completion 为假实现，无真实外部模型、部署或生产验收。

本文由两份方案合并而成：一份是《内核语言无关化实施方案》（提交 `38310f75`，已删除），另一份是《可信本地跨平台运行与远程执行应用化方案》（旧稿已删除，可从 Git 历史查阅）。两者都在改造内核，而且会改到同一批文件，因此合并为同一条实施路线。

当前已有运行时、合同、应用及独立设备实现；本文保留原始目标和阶段交付标准，以阶段状态区分已实施、待验证和未完成。实际 RemoteDevice→生产 HTTP→真实应用 SDK→内核预算预留→实际 Pi 1.5.0 原生文件工具→内核验证签名停止→cleanup 已定向通过，仅 completion I/O 使用假实现，无外部模型调用。实际程序在本机运行不等于跨主机、外部模型或生产验收；Windows 后端已实现但未原生验证，macOS 完整后代监管后端未实现并保守拒绝。现有用户数据迁移仍不在目标内。

| 阶段 | 当前状态 | 已有证据与边界 |
| --- | --- | --- |
| S0 | 已实施，最终接受仍有门槛 | hash 基线、Agent 快照及故障合同已有实现与检查；晚到 baseline 9 pass；设计草案不能代替现行接口 |
| S1 | 已实施，本机 Linux 发行 runtime 已通过 | 可信本地运行、外置 TS 检查、备份与显式 helper 路径已实现；实际编译 fixture 1 pass / 8 断言，checker 16 pass / 94 断言、installer 9 pass / 33 断言；2 个实际安装用例 filtered |
| S2 | 已实施，本机 Linux 发行 runtime 已通过 | Agent 合同与 `@chrona/pi` 拆分、依赖约束已实施；root tsc/API 通过，第三轮 Bun 最终文件无失败清单但含 notify 重试 |
| S3 | 已实施，最终接受仍有门槛 | 系统工具/Manifest JSON、hash 算法、schema `--check` 与基线检查通过；资源与 RUNPATH 修复后本机发行检查通过 |
| S4 | 部分实现，原生平台验收未完成 | Linux 有真实后代停止证据；已选认证 loopback；Windows Job 后端待原生编译运行，macOS 仍仅进程组、缺更强后端 |
| S5 | 部分完成，本机实际设备全链路与修复定向通过 | 17:36 设备最终 39 pass / 325 断言，cold cancel 后生产回归 1 pass / 36 断言；app 2 pass / 15 断言、native 21 pass / 179 断言、fairness 1 pass / 17 断言。逻辑/有限物理配额与治理/模型/cleanup 已接通，新增回归 50 pass / 441 断言；GC/retention、>100 delivery 恢复及完整平台发行矩阵仍未完成 |
| S6 | 未验收 | 三端完整矩阵、完整场景回放及同一最终修订接受仍未完成；本地分次通过不代替接受 |

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
2. **跨进程边界语言中立。** 新增或修改的跨进程接口（模块传输、远程执行应用与内核之间的私有接口、设备协议）都必须能用任何语言实现：使用路由调用、JSON 合同、标准传输，不依赖 Bun 特有能力，也不 import TS 实现。进程如何获得连接信息也属于合同：现行模块传输使用 `CHRONA_IPC_ENDPOINT`、`CHRONA_IPC_TOKEN`，具体字段以 `module-wire.ts` 为准。
3. **必须保留**：真实 caller、精确授权、凭据处理与日志脱敏、模型预算、单 Run 队列、租约、超时、输出与并发上限、取消、实际停止状态、持久化、备份恢复和受控应用生命周期。
4. 按 `AGENTS.md`，被替代的代码、测试、文档和合同字段在同一次改动中删除，不保留转发 re-export 或兼容别名。

## 2. 实施前源码基线

下表保留合并方案时的改造起点和影响范围，不表示这些旧路径仍是当前实现；部分文件已删除或迁移。现行实现入口及证据见 §10 和[验证记录](kernel-portability-verification.md)。历史行号只用于理解原始定位。

| 范围 | 实施前实现 | 历史定位 |
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

实施前已经满足、不需要改的部分：模块线消息格式（`@chrona/contracts` 中的 `moduleEventSchema`、`moduleCallSchema`）；普通模块的合同来自 `module.json`，hash 由手写规范化逻辑加排序键 JSON 计算（`module-tool-contract.ts:9-17,71-78`）；模块版本 hash 是 git tree hash；内核生产代码不 import 任何 `external/*`；Agent 运行时已经打包成 `runtime.js`。实施前 `packages/integrations/src/executor` 中有一部分代码服务器本地执行也在用（工作目录准备与清理），因此 S5 先抽取为共享库再删除旧链路，不能连同本地能力一起删除。

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

普通应用已使用 `remote-execution` 名称，源码位于 [`external/remote-execution`](../../packages/engine/src/modules/steward/external/remote-execution/)。它已登记为普通可选安装包，实际固定 seed 安装通过（`builtin: false`、0 execution authority），未默认安装或增加权限；完整发行 runtime 尚未接受。Agent 仍是唯一不可变的内置应用。

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

图中的连线表示职责和控制路径。S5 已有通用 Run 交付、私有 receiver carrier、普通应用和设备认证入口；实际设备程序经生产 HTTP/真实应用/内核/实际 Pi 到签名停止和 cleanup 已通过确定性测试。模型网关和窄治理已接通，配额、公平性与 cancel-before-journal 修复后的定向回归已通过；有限物理存储已完成定向验证，安全归档、完整生命周期故障矩阵与跨平台发行仍待收口。当前接口以 [`kernel-execution.ts`](../../packages/contracts/src/steward/kernel-execution.ts) 和 [`execution-delivery-carrier.ts`](../../packages/engine/src/modules/steward/execution-delivery-carrier.ts) 为准。继续复用现有 Agent 和应用路由，不引入公共 Provider 注册框架，也不开放"任意应用都能写 Run 状态"的接口。

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

实施前的认领路径直接读取设备表、核对授权代次并准备远程 assignment，停止恢复路径也直接区分 server 和 device。S5 已将内核路径改为同一 Run 队列上的通用持久交付，应用持有设备业务记录；旧内核/服务端路径已有替代并删除，窄治理及实际控制/cleanup 已接通，最终失效引用、可靠性和打包复核仍待收口。以下最小合同和故障状态表继续作为验收要求：

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

需要统一实现的行为：启动、超时、取消、进程树清理、退出观察和能力报告。各平台的实现可以不同，但不能把直接子进程退出当作整个任务树已经停止。现有独立 [`@chrona/process`](../../packages/process/README.md) 在 Linux 使用原生 guardian/subreaper，已有实际后代清理证据，普通本地运行不要求 systemd 262。Windows Job Objects 后端已有代码但尚未原生编译运行；macOS 只有进程组能力，需要完整后代停止的调用方必须在启动前拒绝。SDK 监管包装副本已同步 Windows 分支；跨平台集成、同步检查与发行资源仍须验证。

删除硬内存限制之后，健康检查和配置不能再声称有这项限制。模型 token 预算、工具调用上限、运行时限、输出上限和并发上限继续各自执行。

### 7.2 本地 IPC 与 HTTP

已选择并实现仅监听 `127.0.0.1` 的认证 loopback TCP，内核通道与 SDK 共享 [`transport.ts`](../../packages/integrations/src/steward/module-sdk/transport.ts)，不再以 Bun unix serve/fetch 作为新协议前提。三端实际运行仍待验收，连接信息通过环境变量合同告诉模块进程，并满足 §1.4 第 2 条。

该实现必须持续满足：每个实例一个不可猜测的凭据、绑定到目标实例、启动时的就绪握手、限制监听地址、限制消息大小、处理断连。不能仅凭"来自本机"就授予 caller 身份；内部凭据不能注入到应用自报的 caller 中，也不能写进日志。新增的握手消息纳入 wire schema。

模块 HTTP 继续经过现有的受控路由和代理，内部监听端点不能成为绕过鉴权的公开入口。预览、构建启动检查、SDK testing 和生产运行必须使用同一份合同。

### 7.3 路径、工具与备份

使用 `os.tmpdir`、`path.delimiter` 和平台的解释器布局。依赖按功能检测：TS 应用不会因为缺少 Python、Shell、浏览器或 Nix 而不可用。进程内实现的备份优先沿用现有的受限 ustar 读取合同，覆盖普通目录、文件、空目录、长路径边界、恶意路径和特殊文件；不能因为跨平台而放松恢复时的路径校验或私有存储要求。

## 8. 合同冻结

1. **基线 fixture**：`packages/contracts/fixtures/contract-hashes.json` 记录**改动前**以下工具的 `target → contractHash`：5 个内核命名空间下的全部系统工具、Agent 的全部工具、`external/*/module.json` 中的全部工具。另加几条合成用例，覆盖整数和浮点数、非 ASCII 字符、嵌套 object/array、`enum`、`required` 顺序、`visibility` 顺序。这组用例也是将来其他语言内核要通过的 golden 测试。Agent 的 `module.json` 中 tools 部分另存一份快照。
2. **冻结的 JSON**：`scripts/generate-contract-schemas.ts` 用 zod 生成公共系统工具和 Manifest 合同（`bun scripts/generate-contract-schemas.ts --check` 检查仓库内内容）；S4 已补入 `module-wire.json` 与握手合同：
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

原计划按阶段组织提交；当前实现仍在共享工作区集成，阶段状态不是已提交或已验收的证明。阶段之间的先后顺序由"共用文件"和"依赖关系"决定。下面保留各阶段目标，并附本次核实的进展。

### S0：基线与合同草案

- 按 §8 第 1 条建立 hash fixture 和 Agent tools 快照（只加测试，不改生产代码）。
- 固定要移除的模式、配置、Manifest 字段、发行资源及其调用方清单。
- 完成 §6 远程执行的授权、预算、状态、收据、认证入口和生命周期设计，以及 §9 的故障状态表。
- 确定本地和设备端在各平台上验证停止能力的办法。
- 交付：fixture 测试、合同草案、故障状态表、源码影响表和可执行的验收用例清单。尚未定稿的项不能用空适配器掩盖。
- **当前状态：已实施，最终接受仍有门槛。** 基线与合成向量位于 [`fixtures`](../../packages/contracts/fixtures/)，已有 foundation 定向日志；S5 的四项 Agent 变更及新增应用工具分别在 transitions/additions 清单登记，不能改写 S0 golden。早期 S0 合同草案中已被实现替换的签名/字段不能当作现行 API。

### S1：可信本地运行与 TS 工具链改为运行包

这两部分共用 `script-sandbox.ts`、`module-typecheck.ts`、`module-build-helpers.ts`，所以一起完成。

- 移除 bwrap/required-isolation、`ulimit -v`、`MALLOC_ARENA_MAX`、强制 Shell；处理旧配置和 `virtualMemoryMb` 字段（§3）。
- 引入 `runtimes.json`，类型检查改为由运行时声明（§7.1）。
- 删除 `callsDeclaration`、`tsType`；内核写出 `calls.json`，`module-typecheck/` 新增 `calls.ts` 负责生成 `.d.ts`，`check.ts` 和构建会话都调用它。
- 收缩 Nix 和浏览器自动获取（**在 S2 移动 `browser.ts` 之前完成**），移除 `pi-launch.ts` 中的 bwrap（**在 S2 移动 `pi-launch.ts` 之前完成**），开发辅助 `.sh` 改成 TS。
- 修复路径、解释器和环境变量的构造；完成进程内备份。
- 同步 Agent 生成产物、资源、配置、doctor/health、`AGENTS.md` 和运维说明。
- 交付：本地功能的行为验证；增加一个 `.py` 入口模块完成安装和启动的测试。除显式登记的 S1 `modules.diagnostics` 变更外，hash 基线保持。此阶段不据此宣布三端完整支持。
- **当前状态：已实施，本机 Linux 发行 runtime 已通过。** 运行时表、直接解释器启动、`calls.json` 与运行包内声明生成、可选工具检测及进程内备份已有实现。历史定向 110/130 项及 Python/合同 11 项分别通过，不累加。17:43–17:44 新修复显式可信宿主 `StewardPorts.processHelper`，贯通 checker、bun/uv installer 与父 build declaration helper；[实际编译回归](../../packages/integrations/src/steward/module-packaged-helper.bun.test.ts)从无关 cwd 验证 1 pass / 8 断言，既有 checker 16 pass / 94 断言、installer 9 pass / 33 断言（2 个实际安装用例 filtered）。受限子进程环境未放宽；normalized guardian 的 Nix RUNPATH 缺陷已在构建时修复，受限环境停止证据及 17:55 默认 Linux CLI 离线 runtime smoke 已通过。其他原生平台仍须单独验收。

### S2：Agent 自包含

- 内核与 Agent 之间的 schema 移入 `packages/contracts/src/steward/agent.ts`。`primitives.ts` 中的运行时逻辑留在 Agent，纯 schema 部分迁出。耦合的 4 个内核文件改为从合同包 import，原文件删除。
- 新建 `packages/pi`（`@chrona/pi`），移入 `pi-provider`、`pi-events`、`pi-launch`、`pi-process`、`pi-resources`、`pi-session-resume`、`pi-transcript` 及其测试；改 Agent 的 `runtime.ts`、`executor/daemon.ts`、`pi-model-gateway.ts`、`agent-application-host.ts` 和 `integrations` 的导出，让它们改从 `@chrona/pi` import。
- `browser.ts` 移入 Agent 目录；`transcriptRedactor` 移入 `@chrona/logging/redaction`，同时修改 `transcript.ts`、`module-build-session.ts` 的 import。
- 删除 `builtinCallerMaterial` 和 `module-typecheck-material.macro.ts`；Agent 作为依赖方，按 §4 的方式检查。
- 在 `.dependency-cruiser.cjs` 中加入 §4 的两条禁止规则，测试和 fixture 也遵守。
- 发布打包（`build/manifest.ts`、`build/portable-elf.ts`）纳入 `@chrona/pi`。
- 交付：hash fixture 不变，Agent tools 快照一致；depcruise 不新增例外；在内核目录中 `grep builtin/agent` 没有生产代码命中；`release-smoke` 通过。
- **当前状态：已实施，本机 Linux 发行 runtime 已通过。** 合同迁入 [`agent.ts`](../../packages/contracts/src/steward/agent.ts)，Pi 实现与资源迁入 [`packages/pi`](../../packages/pi/)，依赖规则和 Agent 自包含产物已改造。Pi 定向日志 139 通过、复核日志 51 通过；16:38–16:39 Agent 安装/设置页及脱离源码树的检查失败保留为 HISTORY。17:11:25 第二轮 full Bun 中设置页 3 通过、Agent 安装文件隔离重试 5 通过但有 callback 超时历史，最终失败清单已无 detached 文件；Agent module-calls/release 当轮仍失败。17:27 修复 manifest union 和 admission wake 后，原 module-call 4 项/release 1 项定向通过；完整 API 已确认通过；17:42 第三轮 full Bun 已完成 229 文件，最终无失败文件清单但包含 notify 首次失败后的隔离重试，17:55 在修复 helper 路径和 ELF 搜索路径后，本机默认 Linux CLI 通过离线 runtime smoke，详见[验证记录](kernel-portability-verification.md)。

### S3：冻结系统工具合同

- 按 §8 第 2、3 条生成并提交 `system-tools.json`、`module-manifest.json`（此时 `virtualMemoryMb` 已经删除），运行时改为读取这些文件，并写出书面算法。
- 交付：hash fixture 不变；`grep toJSONSchema` 中不再出现计算 hash 和工具发现结果的生产路径。
- **当前状态：已实施，最终接受仍有门槛。** 生成器只导入独立公共声明，不导入处理器、Agent 或应用运行时；系统工具和 Manifest JSON 已落地，运行时发现、hash、构建提示读取 JSON，保留 zod 校验。早期生成器/合同定向检查通过，旧 golden 未重写；S4 wire JSON 也已生成。15:37:40 扩展消费面日志 41 通过、3 失败（旧 Unix 启动/清理及 notify 列表期望）保留为 HISTORY，第三轮 full Bun 最终文件结果及 notify 重试另记于验证记录；17:23:15 schema `--check` 已通过。构建资源问题已有后续通过证据：`module-build-session` 37 通过，SDK resources 5 通过；它们不是全仓通过。日志来源、先后关系及新 hash 清单见[验证记录](kernel-portability-verification.md)。

### S4：本地通信与进程监管跨平台

- 按 §7.2 完成 IPC、HTTP、预览、测试 SDK 和构建检查的一致实现；SDK 的 `serve` 不再依赖 Bun unix serve；生成 `module-wire.json`（包括握手消息）。
- 完成各平台的进程清理、取消和异常退出处理。
- 交付：三端本地验收矩阵和未支持能力说明。
- **当前状态：Linux 及认证 loopback 已有实现和定向证据，三端未验收。** Linux 原生测试含逃离原进程组的后代、owner 死亡和 guardian 死亡；后者必须返回 unknown 并保留占用。17:07:44 supervisor/lifecycle/build-session 组合日志 88 通过、636 断言，覆盖此前 supervisor 48、build-session 37 的部分用例，不累加；SDK resources 历史 5 通过。Windows Job 后端已实现、待原生编译运行；macOS 仍只有进程组，更强的后代监管后端未实现，要求后代证明时 fail closed。SDK Windows 包装副本已同步，native 资源分发与实际集成仍待验收。原生测试跳过项不能记为平台通过。

### S5：远程应用与设备端拆分

- 先抽出服务器和设备端共用的工作目录准备、锁定和清理代码，保留本地 Coding。
- 设备协议、凭据、配对、映射和业务记录迁入普通应用，提供必要的设备认证入口（§5.3）。
- 改造内核中直接认识 Executor 的认领、路由、恢复和完成路径，只保留最小的可信执行支撑。按 §6 调整 Agent 原语，hash 变化逐项列出。
- 设备端程序依赖 `@chrona/pi`，独立打包；Linux 监管后端与核心解耦。
- 交付：四种组合的验证证据——无远程应用的核心、本地 Coding、已安装远程应用、实际设备端。
- **当前状态：部分完成，本机实际独立设备全链路与可靠性修复定向通过，S5 尚未整体接受。** [生产设备测试](../../packages/remote-device/src/production.bun.test.ts)实际执行 RemoteDevice→生产 HTTP→真实应用 SDK/native carrier→SQLite 内核模型预留→实际 Pi 1.5.0 原生文件工具→内核验证设备签名停止并释放占用→cleanup preview/confirm，仅 completion I/O 为假实现，无外部模型。17:36 设备最终 **39 pass / 325 断言、无 skip**；17:35 native cold-claim 修复后生产用例重跑 **1 pass / 36 断言**，包级 tsc、重建与复制二进制 smoke 通过。app 最终 **2 pass / 15 断言**、原生 **21 pass / 179 断言**、公平性 **1 pass / 17 断言**，最终完整 wire bytes 预留后再验证。历史 server 53 pass / 317 断言、actual Pi 1 pass / 91 断言、model 18 pass / 115 断言覆盖重叠，不累加。治理、模型网关、cleanup、source/终止证据独立逻辑配额与持久公平轮询已接通；认证 ready/reconcile 后 drain-only identity 先入 journal，再产生 never_started 签名及 cancel ACK，禁止 spawn，丢失回复后可安全重放。此前已授权但缺 journal、spawn_possible/running/unknown 仍保留未知停止与占用。有限 SQLite/回滚日志与实际证据预留已实现并通过 50 项回归；安全 GC/retention、>100 delivery 恢复、完整故障矩阵与跨平台发行验收仍未完成，见[验证记录 §4](kernel-portability-verification.md#4-s5-已贯通路径与尚未闭环的部分)。

### S6：三端远程验收与旧链路清理

- 覆盖三端设备上的执行、断连、取消、重启、撤销和应用更新/卸载。
- 删除被替代的设备专用内核协议、直接数据库耦合、配置和打包残留。
- 发布矩阵分别列出服务端和设备端的支持情况。
- 交付：准确的命令、修订、平台、通过项、失败项和限制；不用历史 smoke 代替本轮验收。
- **当前状态：未验收。** 原生平台 workflow 已添加但未运行；Windows Job 源码未在原生平台编译运行，macOS 完整后代监管未实现，要求该能力的调用方拒绝启动。root tsc final7、lint final4、边界 final2、完整 API/schema 分次通过；第三轮 full Bun 跑完 229 文件，最终文件结果 2450 pass / 38 skip，但 notify 首次失败后重试通过。持久化等待修复后定向 17 pass / 0 fail，历史失败保留。最终 14 seeds、编译、资源、CLI、SDK checker、ELF 与 archive 检查通过；实际 remote-execution 固定 seed 安装使用正式打包 helper，通过且 builtin=false、authority=0。17:55 在修复 helper 路径及 RPATH 后，默认 Linux CLI 以离线冻结安装完成完整 runtime smoke。独立设备复制二进制 smoke 通过。foreign Linux/arm64、跨主机、外部模型、生产及完整场景回放均未接受，详见[验证记录](kernel-portability-verification.md)。

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

- 按 `AGENTS.md` **串行且限制内存**执行 `typecheck`、`lint`、`check:boundaries`、`test:bun`、`test:api`；Linux 可用带 `MemoryMax` 的 systemd-run，具体命令与原生 macOS/Windows 的执行条件见[验证记录](kernel-portability-verification.md)。不能把 systemd 作为产品运行依赖或原生平台测试的替代。
- 端到端回放：在全新数据目录中完成一次 Agent 运行（普通对话请求和一次 Coding 项目工作）、一次当前会话创作（Agent 在已有 Run 中开发和构建，Author 提交精确材料，再检查、激活）、events/notify/web 三类 hash 绑定各一次，并按 [steward-goals](steward-goals.md) §8 场景回放、保存截图。绿色 CI 不能替代这一步。
- 开发阶段用临时数据库、假 completion 和真实本地进程覆盖故障场景。当前已有实际设备程序、实际生产 HTTP/SDK/内核与 Pi 的本机确定性通过；跨主机设备、外部模型、账号或部署验收须另记范围、环境和证据。自动化测试遵守 `AGENTS.md`，不调用真实模型或 QQ。
- 每个阶段结束时在本文追加一行状态，写明实际运行的命令和结果；没有运行的项要如实写明。

## 12. 主要待验证事项

| 事项 | 当前进展与剩余验收 |
| --- | --- |
| 设备 HTTP 与 owner 鉴权分离 | 生产 pair/poll/report/reconcile/model 与真实 API key owner 入口已接通；server 17:12 定向通过。owner cleanup 不冒充 module caller；剩完整故障/生命周期及最终回归 |
| Run 交付与应用私有记录一致性 | 固定 key、真实 SDK/carrier、窄 revoke/cancel/reconcile/retention、原 activation 排空已实现；两 slots、receiver 更替与 cold cancel 已修复，先 journal 后签名 never_started/ACK，禁止 spawn。最终设备 39 pass / 325 断言，native cold-claim 修复后生产 HTTP 1 pass / 36 断言；完整代次/故障组合待验收 |
| 停止证据可信边界 | Linux 有真实后代实验、内核有签名验证；guardian 丢失仍 unknown，其他原生平台未验收 |
| 设备端模型预算 | 实际 Pi→生产 HTTP→应用 SDK→内核模型预留/固定收据已通过，pending unknown 不重发；kernelPiDriver 已用于生产路径，缺 Pi/可信网关才拒绝。外部模型与跨主机验收未完成 |
| Windows/macOS 进程监管 | Windows 已实现待原生编译运行；macOS group-only，完整后代监管后端未实现 |
| loopback IPC/HTTP | 已选认证 loopback 并实现共享传输；三端模块 HTTP、预览、SDK testing 与构建须同修订验收 |
| 分发及独立设备打包 | 最终 14 seeds、编译/资源/CLI/SDK checker/ELF/archive 检查通过；设备最终构建、仓库外复制二进制 smoke 与本地 archive 通过，二进制 hash `29e7868…`。完整 Pi CLI 1.5.0 是显式外部依赖。17:55 核心默认 Linux CLI 在 helper 路径、RPATH 修复后，以离线冻结安装通过完整 runtime smoke；兼容 Linux/libc、arm64、跨主机仍未接受，未发布 |
| 全局回归与清理 | helper 修复后 root tsc final7 exit 0、lint final4 438 files / 0 errors / 1 既有 warning、边界 final2 0 errors / 35 warnings（796 modules / 4166 dependencies）；先前 schema/SDK 比对及 API 105 pass / 19 files 通过。第三轮 Bun 完成 229 文件，最终 2450 pass / 38 skip，notify 首次失败后重试；修复后新回归 17 pass / 0 fail。旧路径已替代删除，历史失败保留；不构成无重试全绿或 S6 接受结论 |
| 应用存储与恢复容量 | source 完整 canonical bytes 上限及 gap/final/stop/cancel 独立逻辑配额、exact wire bytes 批次预留、app/native 持久公平轮询已完成；app 2 pass / 15 断言、native 21 pass / 179 断言、fairness 1 pass / 17 断言，cold cancel 生产回归通过。有限 SQLite/DELETE 回滚日志和实际证据预留已验证；GC/retention、超过 100 delivery journal 恢复未完成，>100 pending controls 回归不能替代恢复验收 |

## 13. 相关文档

- [可移植性验证记录](kernel-portability-verification.md)：本轮实际证据、平台矩阵、复现命令与未完成验收。
- [内核永久边界合同](kernel-permanent-boundary-contract.md)、[实施记录](kernel-permanent-boundary-implementation.md)：当前内核职责与应用生命周期的基线。
- [当前架构](architecture.md)、[模块依赖方向](module-dependency-direction.md)：依赖与所有权规则。
- [Coding 退役说明](coding-retirement.md)：业务调用面；不借远程拆分重建 Coding 协议。
- [统一模块协议与本地／远端宿主](unified-module-runtime-plan.md)：历史与阶段背景；本文不重启已推迟的通用远程宿主工作。
- 合并前的《可信本地跨平台运行与远程执行应用化方案》：`git show fbc4464a:docs/zh/history/cross-platform-runtime-and-remote-execution-plan.md`。
