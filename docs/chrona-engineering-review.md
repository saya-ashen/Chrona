# Chrona 工程质量审查

> 审查日期：2026-07-28
> 范围：系统架构、模块边界、代码规范、安全认证与秘密、并发一致性、运行时恢复、资源生命周期、Provider/MCP/AI 合同、HTTP/SSE 与输入校验、数据迁移与文件安全、构建发布与供应链、测试可靠性、性能、可观测性、配置/文档漂移；**不包含产品设计、视觉设计或可用性评价**。
> 方法：架构基线、CodeGraph 结构追踪、源码专项审查、静态量化、受控故障/并发实验、依赖审计、验证命令、交叉核查与报告验收。用户已取消原“最多 5 轮”限制，后续专项均已完成。

## 1. 执行摘要

Chrona 的目标分层清晰，但当前实现不能称为“干净”。`apps/*`、`features/*`、`packages/engine`、`packages/domain`、contracts/provider/db 等职责已有书面定义；然而实际依赖和代码复杂度已明显偏离这些定义。当前全仓类型检查、desktop E2E 和 Linux binary smoke 通过，但 `test:ci` 与迁移测试在最终验收重跑时失败；即使所有测试全绿，也不能证明架构边界、并发一致性、安全性或长期可维护性健康。

静态门禁已经失去“阻止继续恶化”的能力：ESLint 当前 **721 条 warning，允许上限 724，仅剩 3 条余量**；依赖边界检查报告 **237 个 warning、0 error**，包含执行引擎、graph-runtime、i18n 及 feature barrel 的循环依赖。专项验证还确认了默认跨源无认证 API、非 loopback bind 校验缺口、嵌套 AI client secret 泄漏、scheduler lease 竞争、迁移错误误 baseline、MCP scope/idempotency 弱边界、进程内资源无界增长及 56 条依赖 advisory。当前 CI 测试本身还存在 3 个失败文件，进一步说明“workflow 有门禁”不等于工作树满足门禁。

本报告的问题均是**聚合问题类别，不是问题实例总数**。仅工具可量化的现存实例包括：721 条 ESLint warning（327 条复杂度、171 条函数过长、151 条无效条件、41 个文件过长等）、237 条依赖边界 warning、56 条依赖 advisory（21 high、28 moderate、7 low），以及多个进入核心执行路径的循环依赖。报告区分静态告警、源码证实的缺陷和动态复现的缺陷；未把一类问题的数量误称为全部缺陷数。

### 总体评级

| 维度 | 评级 | 依据 |
| --- | --- | --- |
| 架构目标 | 良好 | `docs/en/architecture.md:30-49, 227-235` 明确分层与规则 |
| 类型与合同 | 良好 | `bun run typecheck` 通过；contracts、domain、ui-protocol 有独立测试 |
| 运行时一致性 | 较弱 | approval 多表吞错；scheduler lease 并发双获租；session/plan-run 首次写存在 check-then-create 竞争 |
| 安全与秘密 | 较弱 | 默认 wildcard CORS + 可选 API key；非 loopback bind 漏检；嵌套 provider env 可由 API 返回 |
| 模块边界 | 较弱 | `check:boundaries`：237 warnings，含核心执行路径循环依赖 |
| 代码可维护性 | 较弱 | 721 lint warnings；多个 1,000–3,154 行生产文件及超复杂函数 |
| 测试与迁移 | 较弱 | 当前 `test:ci` 有 3 个失败文件；迁移测试硬编码数量已漂移，且 runner 可把未执行 SQL 错记为 applied |
| 发布与供应链 | 需改进 | 多平台 binary smoke 完整；但 `bun audit` 返回 56 advisories，CI/Release 未运行 vulnerability gate |
| 性能与可观测性 | 较弱 | 多个进程级 map 无淘汰、认证 O(n)、事件无 retention；health 仅返回静态 ok，缺少 DB/orchestrator readiness |

## 2. 核心模块清单与覆盖情况

“核心模块”按架构文档的运行层、垂直 feature、共享合同、持久化和发布入口定义；仓库结构与该定义一致，无需人工消歧。

| 核心模块 | 路径 | 主要职责 | 审查覆盖情况 | 生产/测试规模证据 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Web composition | `apps/web` | SPA bootstrap、router、browser infrastructure | 已覆盖：结构、SSE 入口、错误边界、测试分布 | 43 TS/TSX 文件，约 2,743 LOC，13 个测试文件 | 边界较薄；共享 HTTP/SSE 仍缺直接测试 |
| Server transport | `apps/server` | Hono 路由、校验、SSE、静态服务 | 已覆盖：路由、错误处理、provider approval、一致性 | 106 文件，约 20,023 LOC，70 个测试文件 | 测试密度高，但部分路由承担业务与持久化编排 |
| Feature slices | `features/*` | 垂直功能 UI/server/contract | 已覆盖全部 11 个架构列明 slice，并检查尺寸/复杂度/测试 | 合计 286 文件，约 78,058 LOC；主要测试集中在 task-workspace、schedule | 结构已落地，但 workspace/schedule/goals 聚集高复杂度 |
| Engine | `packages/engine` | Task/Plan/Execution/Schedule/Projection/AI use cases | 已覆盖：入口、执行、编排、AI、调度、循环依赖、lint 热点 | 288 文件，约 55,592 LOC，88 个测试文件；281 条 lint warning | 最大风险集中区；需优先拆环和缩减高复杂编排器 |
| Domain | `packages/domain` | IO-free 业务规则 | 已覆盖：依赖限制、规模、测试、lint | 49 文件，约 6,157 LOC，21 个测试文件 | 边界规则明确，测试覆盖相对好 |
| Contracts | `packages/contracts` | API/AI/plan/SSE/MCP schema 和 DTO | 已覆盖：依赖位置、循环链、测试 | 51 文件，约 8,420 LOC，9 个测试文件 | 合同集中合理，但 plan-runtime 内部出现循环依赖 |
| Graph runtime | `packages/graph-runtime` | 图构建、解析、transition、command | 已覆盖：`createGraphRuntime`、类型依赖、测试 | 42 文件，约 5,908 LOC，8 个测试文件；31 条 lint warning | 核心 API 有测试，但 types barrel 形成多条循环 |
| Providers | `packages/providers/*` | 外部 provider 协议适配 | 已覆盖：Hermes SSE、OMP/ACP/Claude/Debug 客户端规模、测试 | 48 文件，约 13,203 LOC，15 个测试文件；54 条 lint warning | 协议隔离存在，但多个客户端成为巨型类/文件 |
| UI protocol | `packages/ui-protocol` | json-render schema/builders/catalog | 已覆盖：builder cast、catalog 规模、测试 | 21 文件，约 3,930 LOC，6 个测试文件 | 有合同测试；`as any` 暴露 action binding 类型缺口 |
| Database | `packages/db` + `prisma` | Prisma/SQLite/bootstrap/repositories/migrations | 已覆盖：迁移文件、fresh/upgrade/checksum 测试、CI gate | DB 源码 13 文件、5 个测试；当前存在 8 个 migration 目录 | 最终验收迁移测试 4 pass/1 fail；baseline 正确性与 release fixture 均有缺口 |
| Runtime core | `packages/runtime-core` | provider/engine 共享 backend-neutral 类型 | 已覆盖：规模、测试分布、lint | 4 文件，约 360 LOC，无直接测试 | 小且低复杂，但共享合同缺直接回归测试 |
| Integrations | `packages/integrations` | 外部日历和经批准的本地/远端集成 | 已覆盖：规模、测试、lint | 16 文件，约 1,430 LOC，1 个测试文件 | 代码量有限；副作用边界需要更多契约测试 |
| CLI / packaging | `packages/cli`, `.github/workflows/release.yml` | 启动、构建、发布、binary smoke | 已覆盖：入口 blast radius、CI/release workflow | CLI 10 文件、2 个测试；`startChronaServer` 无直接覆盖 | 发布流水线强，启动入口测试不足 |
| Shared infrastructure | `shared/http`, `shared/ui` | 通用 HTTP/browser 与 UI primitives | 已覆盖：边界、直接测试、文件规模 | 35 文件，约 3,583 LOC，无直接测试 | 高复用基础设施缺直接测试；`sidebar.tsx` 超尺寸 |
| External plugins | `external-plugins/*` | 核心包图之外的集成插件 | 已覆盖：结构和静态扫描 | 未发现影响本次结论的高严重问题 | 建议继续由集成测试验证协议兼容 |

### Feature slices 逐项覆盖

| Feature | 路径 | 文件/LOC/测试文件 | 覆盖情况 |
| --- | --- | ---: | --- |
| dashboard | `features/dashboard` | 5 / 1,535 / 1 | 已扫描复杂度与页面尺寸 |
| action-center | `features/action-center` | 6 / 1,256 / 2 | 已扫描列表组件与测试 |
| task-management | `features/task-management` | 4 / 1,192 / 2 | 已扫描列表页面热点 |
| task-workspace | `features/task-workspace` | 107 / 35,259 / 34 | 深度覆盖：状态/SSE/plan/UI/依赖热点 |
| schedule | `features/schedule` | 82 / 17,565 / 26 | 深度覆盖：表单、timeline、actions、测试 |
| plan-generation | `features/plan-generation` | 2 / 63 / 0 | 已核查合同与测试盲区 |
| execution-monitoring | `features/execution-monitoring` | 18 / 4,866 / 5 | 已扫描执行 overview 复杂度 |
| ai-clients | `features/ai-clients` | 18 / 3,258 / 5 | 已扫描 manager/form 热点 |
| assistant-surface | `features/assistant-surface` | 6 / 612 / 0 | 已核查 provider/service 直接测试缺口 |
| external-calendar | `features/external-calendar` | 19 / 3,114 / 8 | 已扫描导入同步复杂度 |
| mcp-control-plane | `features/mcp-control-plane` | 8 / 1,250 / 0 | 已核查 routes/UI 直接测试缺口 |
| goals（架构 Quick map 单列） | `features/goals` | 11 / 8,088 / 2 | 深度覆盖：workspace/workbench 与 engine route 边界 |

## 3. 问题清单

严重级别定义：

- **P0**：已观察到会导致数据损坏、远程执行安全失守、发布产物不可用或主路径必然失败。
- **P1**：核心状态一致性、架构边界或 CI 门禁失效，继续演进很可能引入高影响回归。
- **P2**：显著可维护性、测试隔离或合同质量问题；应进入近期工程计划。
- **P3**：低风险清理或一致性改进。

本次未发现有充分仓库证据支持的 P0。

### ENG-01 — P1 — Provider approval 路由跨层编排且非原子更新

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`apps/server/src/routes/tasks/execution.routes.ts:299-378`
- **证据**：
  - transport route 直接读取 `db.taskPlanProviderApproval`（304-307），调用 provider（325-361），再直接写 approval（329-339 或 365-374）与 provider run（340-343 或 375-378）。
  - 第二次写入使用 `.catch(() => undefined)`（343、378），失败会被静默吞掉。
  - “unsupported provider” 分支还调用 `rebuildTaskProjection`（344），而正常 resolution 分支未显示同等 projection 收敛动作。
  - 这与 `docs/en/architecture.md:227-235` 的“routes stay thin / Engine owns application decisions and orchestration”不一致。
- **影响**：approval 已变为 approved/failed，但 provider run 仍是旧状态；HTTP 返回成功却留下跨表不一致；重试和 projection 可能读取矛盾状态。
- **改进建议**：将完整用例移动到 `packages/engine`，定义单一 `resolveProviderApproval` command。外部 provider 调用与数据库提交分阶段处理：先以幂等 token/版本做状态转移，再调用 provider，再在事务中以 compare-and-set 更新 approval、providerRun、canonical event/projection source。禁止吞错；若允许部分失败，持久化显式 reconciliation 状态并由 worker 收敛。route 仅做 schema validation、command 调用与 HTTP error mapping。

### ENG-02 — P1 — 静态质量门禁仅剩 3 条 warning 余量

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`package.json:33`；`eslint.config.mjs:75-95`
- **证据**：
  - `package.json:33` 使用 `eslint . --max-warnings 724`。
  - 实测 ESLint 为 **721 warnings / 0 errors**，仅剩 3 条余量。
  - warning 分布：complexity 327、max-lines-per-function 171、no-unnecessary-condition 151、max-lines 41、max-params 14，其余 17。
  - `bun run check` 当前成功，因此门禁只限制总数，不区分核心模块、规则严重性或新增 warning。
- **影响**：一个小改动即可因历史债务使 CI 失败；反过来，删除其他 warning 可“交换”新增核心风险。总量阈值无法保证触碰文件不恶化。
- **改进建议**：先冻结基线清单并改为 changed-files/逐文件 ratchet；`no-unnecessary-condition` 与核心 execution/db route 的复杂度逐步升为 error；按模块设置预算。每批重构降低上限，最终移除全局 `--max-warnings` 债务桶。

### ENG-03 — P1 — 包边界检查报告 237 个 warning 且无 error

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`package.json:62`；边界配置由 `bun run chrona check boundaries` 调用；代表性循环位置见下列文件
- **证据**：
  - 实测：`237 dependency violations (0 errors, 237 warnings). 1036 modules, 3604 dependencies cruised.`
  - 核心循环链包括：
    - `packages/engine/src/modules/plan-execution/index.ts` → `runtime/node-ai-capabilities.ts` → `agent-tools/node-result-action.ts` → `agent-tools/types.ts` → `services/task-execution.service.ts` → `plan-execution/index.ts`。
    - `packages/engine/src/modules/plan-execution/task-plan-execution.ts` ↔ `use-cases/submit-terminal-node-result.ts`。
    - `packages/graph-runtime/src/types/dispatch.ts` ↔ `types/index.ts`，并串联 `status.ts`、`execution/types.ts`、`commands/types.ts`。
    - `packages/i18n/src/locale.ts` ↔ `routing.ts`；`get-dictionary.ts` ↔ `locale.ts`。
  - 另有 packages 测试反向依赖 `apps/server/src/__tests__/bun-test-helpers.ts`，以及 server tests 深导入 engine internals。
- **影响**：循环依赖使初始化顺序、tree-shaking、测试替换和模块拆分变脆；测试反向依赖 app 层，隐藏了生产边界是否真正可由公共 API 支持。
- **改进建议**：按核心风险排序拆环：先 plan-execution/agent-tools/service，再 graph-runtime type barrels，再 feature barrels/i18n。将叶类型移入无反向引用的 `_leaf.ts` 或专门 contracts 文件；内部模块不得从自身 public barrel 回导。把 DB/test fixture 移到 `packages/db/test-support` 或根 `test-support`，测试也默认遵守生产依赖方向。为核心规则设 error，仅为明确登记的历史例外保留到期 waiver。

### ENG-04 — P2 — 执行引擎与关键 UI 存在极端大文件/高复杂函数

- **问题严重级别**：P2
- **文件路径 / 代码位置**：
  - `features/task-workspace/ui/catalog/workspace-registry.tsx:535`（3,154 行）
  - `features/task-workspace/ui/task-workspace-plan-section.tsx:520,1709`（2,346 行；`TaskWorkspacePlanSection` 683 行）
  - `features/goals/ui/goal-asset-workbench.tsx:513`（2,210 行）
  - `features/schedule/ui/forms/task-config-form.tsx:526,942`（1,515 行；`TaskConfigForm` 670 行）
  - `features/ai-clients/ui/ai-clients-manager.tsx:550,682`（1,500 行；`ClientForm` 645 行）
  - `packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts:551`（1,164 行）
  - `packages/engine/src/modules/tasks/task-activity.ts:538`（1,111 行）
  - `packages/engine/src/modules/plan-execution/kernel/execute-command.ts:548`（852 行）
  - `features/execution-monitoring/ui/task-workspace-execution-overview.tsx:235`（497 行函数，complexity 111）
- **证据**：ESLint 规则在 `eslint.config.mjs:75-95` 设定文件 500 行、函数 100 行、complexity 12；上述均由当前门禁直接报告。警告按模块集中于 `packages/engine` 281 条、`features/task-workspace` 137 条、providers 54 条、schedule 49 条。
- **影响**：状态、IO、转换与渲染控制流耦合；局部改动需要理解大量不相关分支；高复杂函数难以穷举状态组合并增加 review 漏洞。
- **改进建议**：禁止机械按行拆文件。以稳定职责拆分：execution command 的状态机/持久化/事件发布；AI invoker 的 session/stream/tool/result；React 页面按 loader/store、domain view-model、action command、纯 section 组件分层。先为现有 observable contracts 建表驱动测试，再逐段抽取纯函数；每次重构降低对应文件的 waiver/预算。

### ENG-05 — P2 — Provider 实现重复承担流解析和巨型客户端职责

- **问题严重级别**：P2
- **文件路径 / 代码位置**：
  - `packages/providers/omp/src/OmpSdkProviderClient.ts:556`（1,085 行）
  - `packages/providers/claude-code/src/runner.ts:690`（946 行）
  - `packages/providers/acp/src/AcpProviderClient.ts:554`（941 行）
  - `packages/providers/debug/src/ChronaDebugProviderClient.ts:528`（653 行）
  - `packages/providers/hermes/src/sse.ts:1-5`
  - `packages/engine/src/modules/ai/streaming.ts:409-413`
  - `packages/engine/src/modules/ai/feature-normalizers.ts:103,115-124`
- **证据**：至少三处生产代码各自使用 `ReadableStream#getReader()` / `TextDecoder` 解析流；providers 模块共 54 条 lint warning。前端 SSE 已有统一 helper 规则，但 engine/provider 侧没有同等统一的 parser contract。
- **影响**：SSE framing、partial UTF-8、multi-line data、EOF、abort/error 分类可能在各 provider 产生不同语义；巨型客户端混合 transport、session、tool、approval 和 normalization。
- **改进建议**：在 provider foundation/runtime-core 建立经过 corpus 测试的 server-side event-stream parser（不要复用浏览器 helper），明确 framing 与错误模型；provider 只把协议帧映射成统一 runtime events。按 transport/session/tool/approval/result adapter 拆分客户端，公共 conformance suite 对所有 provider 运行相同的 abort、malformed frame、tool lifecycle、terminal result 用例。

### ENG-06 — P2 — 测试覆盖分布不均，部分核心公共边界无直接测试

- **问题严重级别**：P2
- **文件路径 / 代码位置**：
  - `features/assistant-surface/*`（6 个生产 TS/TSX 文件，0 测试文件）
  - `features/mcp-control-plane/*`（8 个生产文件，0 测试文件）
  - `features/plan-generation/*`（2 个合同文件，0 测试文件）
  - `packages/runtime-core/src/*`（4 个生产文件，0 测试文件）
  - `shared/http/fetch-json-event-source.ts`、`shared/http/api-client.ts`、`shared/http/server.ts`（shared 共 35 个生产文件，0 测试文件）
  - `packages/cli/src/start-server.ts:13,110`（CodeGraph 显示 `BootChronaServer`/`startChronaServer` 无覆盖测试）
- **证据**：按文件命名统计显示上述模块无本地测试；CodeGraph 对 CLI 启动入口返回 “no covering tests found”。这不否定 API/E2E 的间接覆盖，但当前无法从模块附近确认公共合同被稳定锁定。
- **影响**：高复用 shared HTTP/SSE 或 MCP control 变化可能只在远端 E2E 暴露；启动/打包环境差异难以快速定位。
- **改进建议**：优先补 observable contract，而非覆盖率数字：shared SSE 的 reconnect/non-stream/error/abort；MCP route 的 auth、schema、session scope；runtime-core config schema；CLI 临时目录启动和信号退出。将间接覆盖通过 feature-test map 显式关联，避免重复测试。

### ENG-07 — P2 — UI protocol 使用 `as any` 绕过 action binding 类型合同

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/ui-protocol/src/builders/build-action-spec.ts:185-198`
- **证据**：`on: { press: actionBinding as any }`，并伴随 `eslint-disable-next-line @typescript-eslint/no-explicit-any`。这是 server builder 与 renderer/action catalog 的共享合同，不是局部 UI 类型。
- **影响**：builder 可产生 TypeScript 接受但 catalog/renderer 不支持的 action payload，错误延迟到运行时 validation 或用户交互。
- **改进建议**：修正 `actionBinding` 与 json-render `on.press` 的可赋值关系；用 discriminated union 或适配函数显式转换，转换后调用 schema parse。增加 compile-time type test 和 `validateChronaSpec()` runtime test，删除 suppression。

### ENG-08 — P2 — 数据库迁移政策与仓库迁移目录需要发布线声明

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`AGENTS.md` 的 Database migration policy；`prisma/migrations/*`；`packages/db/src/sqlite-migrations.bun.test.ts:108-168`；`.github/workflows/ci.yml:47-48`
- **证据**：仓库当前包含 `0001_initial` 加 7 个 2026-07 release-oriented migration 目录；政策要求已发布 migration 不可变、每个未发布 release line 只有一个 mutable migration。测试明确覆盖 fresh install 与 previous-release upgrade，并在 CI/Release 执行，当前 5 个迁移测试通过；但仓库内未从目录名本身说明哪些 migration 已发布、哪个是当前唯一 mutable release line。
- **影响**：维护者可能错误修改已发布 checksum，或继续为同一未发布版本新增 migration；checksum 测试只能在变更后报错，不能代替 release-line 所有权说明。
- **改进建议**：在机器可读 release metadata 或 migration test fixture 中登记 `lastReleasedMigration` 与 `mutableReleaseLineMigration`，CI 校验：已发布 migration checksum 固定、其后至多一个 mutable 目录、previous-release snapshot 对应登记版本。不要仅靠文档和命名推断。

### ENG-09 — P3 — 生产代码存在少量显式 lint suppression 与无效条件

- **问题严重级别**：P3
- **文件路径 / 代码位置**：
  - `features/goals/ui/goal-workspace-page.tsx:2,104,803,1868,2261`
  - `packages/engine/src/modules/goals/goals.ts:1,235`
  - `apps/server/src/routes/goals.routes.ts:35`
  - `features/schedule/ui/dialogs/schedule-page-dialogs.tsx:37-40`
  - `features/schedule/ui/schedule-page-actions.ts:358-361`
  - `apps/server/src/routes/pages/work.routes.ts:101`
- **证据**：生产代码扫描发现 13 个 lint suppression、5 个 `any` cast；全仓另有 151 条 `no-unnecessary-condition` warning。
- **影响**：suppression 长期化会掩盖类型漂移；无效条件增加对实际状态空间的误判。
- **改进建议**：每个 suppression 要求 issue/到期条件；优先删除 schedule 的 `any` 签名并复用 router 类型。批量修复 unnecessary-condition 前先确认不是 schema/type 已错误收窄，避免只删除运行时防御。

### ENG-10 — P1 — 默认配置允许任意网站跨源调用无认证 API

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`apps/server/src/config/env.ts:13-16,54-56`；`apps/server/src/app.ts:49-66`；`apps/server/src/middleware/auth.ts:6-34`
- **证据**：`ALLOWED_ORIGINS` 默认 `*`、`API_KEY` 可选；auth middleware 在未配置 key 时直接放行，`OPTIONS` 也总是放行。受控 Hono 请求实测：恶意 `Origin` 的 `OPTIONS /api/tasks` 返回 204 与 `Access-Control-Allow-Origin: *`；同一 Origin 的 `POST /api/assistant-surface/actions` 返回 200、`Access-Control-Allow-Origin: *`，响应体为已执行 action 的结果。
- **影响**：用户只要打开恶意网页，该网页即可从浏览器向默认 localhost Chrona 读取/提交 `/api/*`；同一边界包含 Task、AI client、execution 与文件访问 mutation。local-only bind 不能防浏览器跨源请求。
- **改进建议**：默认仅允许 Chrona 自身 UI Origin；若 `API_KEY` 未配置，拒绝非受信 Origin 和所有 credentialed/cross-site mutation。把 wildcard 设为显式 unsafe override，并增加 preflight + 实际 mutation 的浏览器/HTTP 合同测试。

### ENG-11 — P1 — Public bind 防护只识别 `0.0.0.0`

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`apps/server/src/config/env.ts:59-75`；`scripts/dev.ts:5-30`；`apps/server/src/index.bun.ts:18,26-38`
- **证据**：`assertSafeBind()` 与 dev guard 仅比较 `HOST === "0.0.0.0"`。受控调用结果：`0.0.0.0` 被拒绝；`::`、`192.168.1.50`、`chrona.local` 均在无 `API_KEY`、无 unsafe override 时放行；`127.0.0.1`、`::1` 正常放行。startup warning 的 unsafe 判断同样只覆盖 `0.0.0.0`。
- **影响**：IPv6 wildcard、LAN IP 或解析到非 loopback 的 hostname 可绕过启动保护，以无认证模式暴露完整 API。
- **改进建议**：用 IP/hostname 归类判断 loopback，而非单字符串比较；支持 IPv4/IPv6 wildcard、具体 interface 地址及 hostname resolution 的 fail-closed 规则。dev、server、CLI 共用一个安全函数和矩阵测试。

### ENG-12 — P1 — AI client 配置仅浅层脱敏，嵌套环境变量秘密经 API 返回

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`apps/server/src/routes/ai/clients.routes.ts` 的 `redactClientConfig()` 与 list/get response；`packages/contracts/src/ai-feature-types.ts` 的 Claude Code/Codex/OMP `env?: Record<string,string>`
- **证据**：redactor 只删除顶层 `apiKey`、`token`、`secret` 等字段。受控 route 调用中，顶层 `apiKey` 被移除，但 `config.env.ANTHROPIC_API_KEY="nested-secret"` 与 `config.env.CUSTOM_TOKEN="nested-token"` 原样出现在 JSON 响应。
- **影响**：任何可调用 AI client API 的主体或跨源网页都可读取持久化 provider credentials；日志 redaction 无法修复 response 泄漏。
- **改进建议**：定义 provider-specific public config schema，采用 allowlist 输出；`env` 只返回变量名/已配置标志，不返回值。创建、更新、日志、审计和 response 共享递归 secret classifier，并增加嵌套对象/数组回归测试。

### ENG-13 — P1 — Scheduler lease 获取不是原子 CAS，竞争 owner 可同时获租

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`packages/engine/src/modules/orchestration/scheduler-lease-repository.ts` 的 `acquireSchedulerLease()`；`packages/engine/src/modules/orchestration/task-orchestrator.ts` 的 worker 续租路径；`packages/engine/src/modules/orchestration/scheduler-lease-repository.bun.test.ts:23-114`
- **证据**：获取逻辑先 `findUnique`，再无条件 `upsert`，没有条件更新/事务 CAS。动态并发实验让 owner `a`、`b` 同时获取同名空 lease，两个调用均返回 `{ acquired: true }`，最终 DB owner 为 `b`。现有测试只覆盖串行竞争。orchestrator 在每个 worker 前调用 `renew()`，但未检查 `renewed`。
- **影响**：两个 server/process 可同时认为自己持有 scheduler ownership，重复执行 auto-plan、scheduled work、recovery 等副作用；失租 owner 仍继续当前 worker。
- **改进建议**：用单条条件 `UPDATE ... WHERE ownerId=? OR expiresAt<=?` 配合唯一行创建冲突重试，或 `BEGIN IMMEDIATE` 实现 CAS；只有实际受影响一行才返回 acquired。每个 worker 前若续租失败立即停止 tick。增加两个独立 DB connection 的并发测试。

### ENG-14 — P1 — ExecutionSession 与 nullable PlanRun 首次写无法保证单例

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`packages/engine/src/modules/plan-execution/persistence/execution-session-store.ts` 的 `ensureExecutionSession()`；`packages/engine/src/modules/plan-execution/persistence/plan-run-store.ts` 的 `savePlanRun()`/`savePlanRunGuarded()`；`prisma/schema.prisma:1775-1805` 及 `TaskPlanRun` 唯一约束
- **证据**：两条路径均为先查后建。`ExecutionSession` 没有“每 task/workBlock 至多一个 Active/Paused”数据库约束；`TaskPlanRun` 的 `@@unique([taskId, planId, workBlockId])` 在 SQLite 中允许多个 `NULL`，而 `savePlanRunGuarded()` 在记录不存在时回退到未 guarded create。
- **影响**：并发 start/retry/首次 graph command 可创建多个 active session 或多个 null-workBlock plan-run；后续 `findFirst`/projection 读取的权威行不稳定。
- **改进建议**：为 null scope 建规范化非空 scope key 或 partial unique index；session 用独立 active-scope ownership 行/事务 CAS。首次创建与 epoch 更新走同一原子协议，并加入并发双请求测试。

### ENG-15 — P1 — Kernel epoch 只保护最终 JSON 写，前置副作用不会回滚

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`packages/engine/src/modules/plan-execution/kernel/execute-command.ts` 的 command 执行与 `savePlanRunGuarded()` 调用；`packages/engine/src/modules/plan-execution/persistence/plan-run-store.ts`
- **证据**：在 guarded plan-run 保存前，command 已可能 ensure/update session、activate WorkBlock、append main-session event、cancel Run、register deliverable 或触发 provider dispatch。epoch conflict 只拒绝最终 mutable graph 写，不撤销这些副作用；`retry_node` 的 active provider-run 检查也是 check-then-act。
- **影响**：两个并发 command 中失败的一方仍可能留下 event、artifact、cancel 或 provider invocation，形成 graph 与外部副作用不一致和重复执行。
- **改进建议**：先以 command id/idempotency key + expected epoch 原子 claim，再执行副作用；DB 内副作用置于同一事务，外部 provider 使用 outbox/claimed intent 与 reconciliation。冲突方在任何外部调用前退出。

### ENG-16 — P1 — SQLite migration runner 可把未执行 SQL 错记为 applied

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`packages/db/src/sqlite-migrations.ts:56-117,155-187`；`packages/db/src/sqlite-migrations.bun.test.ts:77-168`
- **证据**：当 `_prisma_migrations` 为空且检测到任意应用表时，runner baseline **全部** migration，不核对目标 schema。动态实验仅创建 `Unrelated` 表，runner 随后把两个创建其他表的 migration 都记为 `applied_steps_count=0`，目标表均不存在。另一实验的 migration 先执行重复列 `ALTER`、后创建新表；正则捕获 `duplicate column name` 后 baseline 整个 migration，新表未创建但 migration 被记为 applied。
- **影响**：部分/漂移数据库可永久跳过 schema 变更，之后 checksum 与启动均显示成功，运行到访问缺失表/列时才失败。
- **改进建议**：移除通用错误字符串 baseline。仅允许显式 `migrate resolve`/受版本约束的已知 baseline；每个 migration 执行后验证目标 schema fingerprint。已有 schema 的自动 baseline 至少对完整 Prisma schema 做结构等价校验。

### ENG-17 — P1 — 依赖漏洞未进入 CI/Release 门禁

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`package.json:67-123`；`bun.lock:1258,1778,2374,2470,2658,2710`；`.github/workflows/ci.yml:17-48`；`.github/workflows/release.yml:15-49`
- **证据**：`bun audit --json` 当前退出 1，返回 **56 advisories：21 high、28 moderate、7 low**。high 涉及 11 个 package，包括锁定的 `hono@4.12.14`、`react-router@7.14.2`、`vite@8.0.10`、`sharp@0.34.5`、`undici@7.25.0`、`adm-zip@0.5.18`。CI 与 Release 均未运行 vulnerability audit，也未发现 Dependabot/Renovate 配置。
- **影响**：已知 DoS、CORS、安全代理、压缩/图像处理和开发服务器漏洞可随 release 继续发布；是否可达因 package/feature 而异，但当前没有自动 triage 或阻断。
- **改进建议**：先升级直接依赖并重锁传递依赖；CI 对 high/critical 默认失败，例外必须记录 package、CVE、不可达证据、owner 和到期日。启用依赖更新机器人和周期 audit；发布 job 必须复用同一 gate。

### ENG-18 — P1 — MCP mutation scope 依赖可伪造的 session 字符串分类

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`features/mcp-control-plane/routes/mcp.routes.ts:298-325,342-385`；`packages/engine/src/modules/agent-tools/operations.ts:172-242`
- **证据**：`toolSessionPurpose()` 仅按 `sessionId` 是否包含 `:execute:`、`:work-block:`、`:plan-` 或特定后缀决定 mutation allowlist。`resolveInputContext()` 查不到 session/run 时仍保留 caller sessionId，并接受 caller `taskId`，workspace 可回落到默认 workspace；未要求 session 必须存在且绑定同一 task。MCP route tests 明确用构造的 `chrona:task:task-1:execute` 通过 mutation dispatch。
- **影响**：持有通用 API key 的客户端可构造 execution-shaped sessionId，对已知 taskId 调用 node terminal mutation；session purpose 没有成为不可伪造、持久化的 capability。
- **改进建议**：mutation 必须解析到真实 TaskSession/Run/ExecutionSession，并验证 active status、task/workspace、node attempt 和允许工具集合；unknown session fail closed。purpose 由持久化 session type/capability 字段提供，不从字符串猜测。

### ENG-19 — P2 — Agent tool 幂等缓存只在单进程内且无界

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/engine/src/modules/agent-tools/operations.ts:52,59-62,245-350`；`prisma/schema.prisma:1202-1243`
- **证据**：accepted mutation 仅写入 module-level `Map<string, ChronaToolResult>`；无 TTL、容量、delete 或持久化 unique idempotency key。`ToolInvocation` 有 audit 数据但没有对应 idempotency 唯一约束。重启、多进程或 crash 后 replay 不会命中，长期运行则 Map 持续增长。
- **影响**：同一 MCP mutation 在重启/切换进程后可能重复产生副作用；大量唯一 key 会造成内存增长。
- **改进建议**：在数据库建立 workspace/task/tool/idempotencyKey 唯一记录，事务内 claim 并持久化 accepted/rejected terminal result；进程缓存只作有界加速层。

### ENG-20 — P2 — Provider event 合同未在 engine 边界运行时校验或强制终态唯一

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/providers/foundation/src/contracts/provider.ts:372-519`；`packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts:742-818`；`packages/providers/foundation/src/provider-capability-matrix.bun.test.ts`
- **证据**：foundation 导出严格 `providerRunEventSchema`，但 engine/provider boundary 未调用其 `parse/safeParse`。`collectProviderRunSnapshot()` 接受 TypeScript event、忽略 sequence 单调性，并允许多个 terminal event，后出现的 terminal 覆盖先前 snapshot。现有统一测试仅覆盖 capability matrix；每个 provider 没有共享的 ordering/cancel/approval/terminal conformance suite。
- **影响**：第三方/未来 provider 的畸形、乱序或重复终态可被持久化，最终 canonical status 取决于事件顺序而非合同。
- **改进建议**：stream 边界逐事件 schema parse，验证 run/session identity、sequence 单调性和 exactly-one terminal；违约产生明确 `run_failed`/diagnostic。对每个 provider 跑同一 conformance corpus。

### ENG-21 — P2 — MCP/HTTP payload 与 transport session 缺少全局资源上限

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`apps/server/src/app.ts:42-70`；`packages/contracts/src/api/mcp-task-tools.schema.ts:109-187`；`features/mcp-control-plane/routes/mcp.routes.ts:175-203,430-463`
- **证据**：server 未设置全局 body limit；除 email adapter 的局部 50,000 字符检查外，未发现 `Content-Length`/stream limit。MCP completion、request-input、block/fail schema 的字符串、数组、`z.unknown()` 与 evidence record 多数无 max。每个 MCP session 建 server/transport 并存入 Map，只在 client close callback 删除，没有 TTL/容量。
- **影响**：本地或已认证客户端可用大 JSON、深 evidence/diagnostics、海量 fields/options 或不关闭 session 放大内存、JSON hash、校验和持久化成本。
- **改进建议**：在解析前设置全局 hard byte limit，并为大端点设置更小预算；schema 限制字符串、数组、嵌套深度和总元素。MCP transport 增加 idle TTL、最大 session 数、close-on-abort 和指标。

### ENG-22 — P2 — Provider run handle 与 ACP approval waiter 生命周期无界

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/providers/omp/src/OmpSdkProviderClient.ts:589-590`；`packages/providers/acp/src/AcpProviderClient.ts:721-724`；`packages/providers/claude-code/src/ClaudeCodeProviderClient.ts:201-203`；`packages/providers/debug/src/ChronaDebugProviderClient.ts:310-312`
- **证据**：四个 client 都把 runs 放入长期 Map；未发现 `runs.delete/clear`。OMP `finish()` 使用 `void handle.session?.dispose()`，清理失败不可观察。ACP `waitForApprovalEvent()` 注册 resolver，`Promise.race` 的消息分支获胜时未取消对应 waiter，长流可积累 stale resolver。
- **影响**：daemon 运行时间越长，terminal run output/session/queue/approval closure 占用越高；provider session dispose 失败不会进入 health/日志合同。
- **改进建议**：terminal 后保留有界 LRU/TTL snapshot，立即释放 live handle；dispose 纳入 awaited shutdown/finalization 并记录失败。approval waiter 使用可取消 promise，在 race loser、abort、terminal 和 close 全部删除。

### ENG-23 — P1 — 恢复收敛写入非事务化，sync kernel 把真实故障当 stale duplicate 吞掉

- **问题严重级别**：P1
- **文件路径 / 代码位置**：`packages/engine/src/modules/plan-execution/use-cases/sync-runtime-result/reconcile-stale-runtime-runs.ts`；`packages/engine/src/modules/plan-execution/kernel/sync-runtime-result.ts`
- **证据**：reconcile 依次更新 canonical Run、PlanRun runtime result、Task projection，不在一个事务/可恢复 state machine 内；上层 `syncPlanRunRuntimeResult()` 捕获所有异常并只按“No running attempt matches ... stale/duplicate sync”记录，未按 error code 分类。
- **影响**：数据库错误、epoch conflict 或实现 bug 可留下 Run 已终态而 graph/session/projection 仍 running；worker 表面继续，异常失去告警和重试语义。
- **改进建议**：只忽略明确 typed stale/duplicate error；其余失败持久化 reconciliation failure 并重试/告警。把同库状态转移放入事务，projection 在 canonical commit 后幂等重建并记录 sync status。

### ENG-24 — P2 — 认证和事件保留路径会随运行时间线性增长

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/engine/src/modules/plan-execution/runtime/agent-control-store.ts` 的 `validateRunToken()`/`TOKEN_TTL_MS`；`prisma/schema.prisma` 的 `RunToken.tokenHash @unique`；`packages/engine/src/modules/tasks/task-activity.ts:1113-1155`；Event/RawEventLog/TaskTimeline persistence
- **证据**：run token validation 读取全部未撤销、未过期 token 后逐个 timing-safe compare，尽管 `tokenHash` 已唯一；默认 TTL 24 小时，`revokeRunToken()` 的生产调用未发现。活动读取虽有上限，但 Event/RawEventLog/Timeline 未发现通用 retention/prune，数据库和索引会持续增长。
- **影响**：token 数与历史事件量增加会提高认证延迟、SQLite 文件/备份/查询成本；泄漏 token 的权限窗口也偏长。
- **改进建议**：按 hash 唯一查询并在 Run/node terminal 或 session close 主动 revoke；缩短 TTL。定义可配置 retention/归档与分批清理，保留审计所需摘要/checksum 而非无限 raw payload。

### ENG-25 — P2 — Health endpoint 不反映依赖 readiness，server shutdown 未停止 orchestrator

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`apps/server/src/app.ts:68`；`apps/server/src/routes/api.ts:29-31`；`apps/server/src/runtime-bootstrap.ts:7-17`；`apps/server/src/index.bun.ts:65-80`; `packages/engine/src/modules/orchestration/task-orchestrator.ts:193-204`
- **证据**：`/health`、`/api/health` 固定返回 ok，不检查 DB/migration、orchestrator lease、provider registry 或 recovery backlog。bootstrap 丢弃 `startTaskOrchestrator()` 返回 handle；shutdown 只 `server.stop(true)` 和断开 DB，没有 `orchestrator.stop()`。
- **影响**：readiness 可在 DB/调度不可用时误报健康；优雅关闭期间 scheduler interval/worker 可能继续访问正在 disconnect 的 DB，终止依赖 `process.exit(0)` 强制结束。
- **改进建议**：分离 liveness/readiness；readiness 至少执行 DB quick query、migration state 和 orchestrator状态。bootstrap 返回 lifecycle handle，shutdown 先停止接收请求、await orchestrator/active jobs、再断 DB。

### ENG-26 — P2 — 文档和 root scripts 已漂移，源码开发入口不可用

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`package.json:25-65`；`docs/en/architecture.md:214-225`；`docs/en/quick-start.md:78-83`；`docs/README.md:93-100`；`docs/en/README.md:92-99`
- **证据**：文档要求 `bun run server:start`、`bun run dev:web`，root `start` 也转发 `server:start`；但 package scripts 未定义后二者。实测三条命令：`bun run server:start` 与 `bun run dev:web` 均报 `Script not found`；`bun run start` 随后因缺 `server:start` exit 1。
- **影响**：源码 quick start 和架构开发入口无法按文档执行，运维人员可能误判安装/运行故障。
- **改进建议**：明确 clean cutover：要么恢复真实 scripts（server 用 `apps/server/src/index.bun.ts`，web 用 workspace Vite），要么统一文档到现有 `bun run dev`/workspace command；在 CI 添加 docs smoke，执行所有宣称的非交互入口。

### ENG-27 — P2 — 发布迁移测试把可变当前 initial 当作 previous release

- **问题严重级别**：P2
- **文件路径 / 代码位置**：`packages/db/src/sqlite-migrations.bun.test.ts:108-168`；`prisma/migrations/0001_initial/migration.sql`; `.github/workflows/ci.yml:47-48`
- **证据**：所谓 previous-release DB 在测试时直接读取**当前工作树** `0001_initial/migration.sql` 创建，而不是不可变已发布快照；随后只断言部分表/列与 migration count。若当前 initial 被改写，before-upgrade fixture 同步变化，测试仍可能通过。
- **影响**：CI 不能证明真实用户从上一发布版本升级；与 release-line policy 的兼容性承诺弱于测试名称。
- **改进建议**：保存上一 release 的 schema/database fixture 与固定 checksum/version metadata；upgrade test 从该不可变 artifact 启动，再运行当前 migrations 并验证完整 schema fingerprint 与关键数据保留。

## 4. 架构与代码规范评价

### 4.1 做得好的部分

1. **分层责任有书面合同**：`docs/en/architecture.md:30-49` 与 `docs/en/package-boundaries.md:30-42` 将 app composition、feature、engine、domain、contracts、provider、graph runtime 分开。
2. **核心验证可重复运行**：typecheck、CI tests、迁移 tests、desktop E2E、binary smoke 均能在本地无交互执行；本次最终状态为 typecheck/E2E/smoke 通过，CI/migration tests 失败，失败详情已完整记录。
3. **CI 供应链基线较严谨**：`.github/workflows/ci.yml:21-30` 固定 checkout/setup-bun action SHA、Bun 1.3.11、Prisma 7.8.0；权限为 contents read。
4. **发布产物验证不是只编译源码**：`.github/workflows/release.yml:50-95` 对 Linux/macOS/Windows x64/arm64 构建并运行 binary smoke。
5. **迁移测试进入 CI/Release**：`packages/db/src/sqlite-migrations.bun.test.ts:108-168` 对 fresh/current-fixture upgrade 做了可重复检查；但 ENG-16/27 说明 baseline 与 previous-release 证据仍需加强。
6. **未发现生产 TODO/FIXME/空 catch/ts-ignore**：本次静态扫描为 0；说明未交付路径没有明显占位符。

### 4.2 结构性偏差

1. **文档边界比自动门禁严格**：架构要求 thin routes，但 `execution.routes.ts` 直接持有 provider 与 DB 状态机；边界检查仅 warning。
2. **barrel 作为反向依赖入口**：engine/graph-runtime 多个循环通过 `index.ts`/`types/index.ts` 形成，说明 public API 与内部组装没有隔离。
3. **复杂度预算是全仓债务池**：721/724 的全局 warning 上限不表达各模块质量，也无法阻止关键模块新增风险。
4. **feature 架构已建立但内部职责仍过粗**：task-workspace、schedule、goals 的单文件/单函数规模显示垂直 slice 内仍需要层次化。
5. **授权边界混用了“有 API key”与“有 execution capability”**：MCP mutation 只按 session 字符串形状分类，未验证真实 active execution scope。
6. **进程内状态替代了持久合同**：scheduler ownership、agent idempotency、provider handle、MCP transport 与 rate limiter 依赖 Map/定时器，缺少统一容量、TTL、重启语义和 shutdown lifecycle。
7. **健康与门禁偏向“可运行”而非“可安全发布”**：静态 `/health`、warning debt pool、无 dependency audit 使 CI 能在核心安全/一致性风险存在时继续通过。

## 5. 改进优先级与执行路线

### 立即（P1）

1. 收紧默认安全边界：可信 Origin allowlist、所有非 loopback bind fail closed、AI client public config allowlist/递归脱敏。
2. 修复 scheduler lease 原子 CAS 与失租停机；修复 ExecutionSession/PlanRun 首次写唯一性、kernel command claim 与 approval/recovery 事务收敛。
3. 修复 migration runner：禁止错误字符串自动 baseline；引入 schema fingerprint 与不可变 previous-release fixture。
4. 将 MCP mutation 绑定真实 active session/task/node capability；把 idempotency 持久化并设唯一约束。
5. 升级有 high advisory 的依赖，在 CI/Release 加 `bun audit` gate 与有期限例外清单。
6. 将 boundary gate 对新增循环与生产跨层依赖升级为 error；将 lint 改为 changed-file/逐模块 ratchet。

### 近期（P2）

7. 在 app 层添加 request hard byte limit；为 MCP schema、transport session、provider handle、approval waiter、rate limiter 和 raw event retention 加容量/TTL/cleanup。
8. provider stream 边界运行时 parse 并实施 exactly-one terminal/sequence 规则；为所有 provider 建共享 conformance suite。
9. 分离 liveness/readiness；server lifecycle 持有并 await orchestrator/provider cleanup。
10. 修复 `server:start`/`dev:web` 的 script-doc drift，并在 CI 执行文档入口 smoke。
11. 优先拆解 `execute-command.ts`、`ai-runtime-invoker.ts`、workspace plan section、workspace registry；每次只按职责抽取并保持 observable contract。
12. 为 shared HTTP/SSE、MCP scope、runtime-core、CLI startup 增加直接合同测试；修复 ui-protocol `as any`。

### 持续（P3）

13. 对 suppression 设置负责人、原因和移除条件；测试 helper 下沉到中立 package，消除 packages/features 反向依赖 apps/server tests。

## 6. 验证记录

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `bun run check` | 通过（exit 0） | 但输出大量 warning；后续 JSON 统计为 721 |
| `bun run check:boundaries` | 通过（exit 0） | 237 dependency warnings、0 errors；包含循环依赖 |
| `bun run typecheck` | 通过 | app 与 e2e TypeScript 均无错误 |
| `bun run test:ci`（当前完成验收重跑） | **失败（exit 1）** | 3 个 Bun test file 失败：Goal Workbench 9 pass/6 fail；migration 4 pass/1 fail；external-result replay 14 pass/1 fail。较早审查轮次曾通过，当前状态已漂移，不能再声称全绿。 |
| `bun test packages/db/src/sqlite-migrations.bun.test.ts` | **失败（exit 1）** | 4 pass、1 fail；fresh/previous-release 测试硬编码期望 7 个 migration，当前实际为 8。另见 ENG-27 的 fixture 设计缺口。 |
| `bun run test:e2e:desktop` | 通过（exit 0） | Chromium：21 passed、1 skipped，约 1.2 分钟 |
| `bun run build:smoke` | 通过（exit 0） | 当前 `linux-x64` release binary runtime smoke passed |
| `bun test apps/server/src/__tests__/api/goal-workbench.bun.test.ts` | **失败（exit 1）** | 9 pass、6 fail；seeded structured-result payload 已不符合当前 catalog，导致 extract/resolve 后续候选为空。 |
| `bun test packages/engine/src/modules/plan-execution/plan-runner.task-executor.external-results.bun.test.ts` | **失败（exit 1）** | 14 pass、1 fail；process-loss replay 场景在 `db.run.findFirstOrThrow()` 找不到预期 Run（P2025）。 |
| `bun audit --json` | 失败（exit 1） | 56 advisories：21 high、28 moderate、7 low；high 涉及 11 个 package |
| CORS 实际请求实验 | 缺陷已复现 | 恶意 Origin 的 preflight 返回 wildcard；实际 POST 返回 200 + wildcard ACAO |
| `assertSafeBind()` host 矩阵 | 缺陷已复现 | 仅拒绝 `0.0.0.0`；`::`、LAN IP、hostname 放行 |
| AI client nested-secret route 实验 | 缺陷已复现 | 顶层 secret 被移除，`config.env` 中 key/token 原样返回 |
| scheduler lease 并发实验 | 缺陷已复现 | 两个 owner 同时返回 acquired=true，最终行被后写 owner 覆盖 |
| migration partial-schema/duplicate-column 实验 | 缺陷已复现 | 未执行目标 SQL但 migration 被记录 `applied_steps_count=0` |
| `bun run server:start` / `bun run dev:web` / `bun run start` | 失败 | 文档入口对应 script 缺失；root start 转发到缺失 script |


## 7. 审查限制与证据解释

- 规模与“测试文件数”来自静态统计；它不是语句覆盖率，也不将间接 API/E2E 覆盖误称为无覆盖。`docs/maps/feature-test-map.md` 当前显示 485 source files、196 direct-covered（40%）、420 transitive-covered（87%）、65 unreachable（13%）。
- CodeGraph 的 “no covering tests found” 仅表示索引未建立直接 test edge；报告仅将其用作补充证据。
- lint/boundary/audit 数量代表工具观察到的实例；严重级别结合可达性、动态复现与核心路径，不按数量机械判断。依赖 advisory 未逐项证明运行时可达，因此 ENG-17 的重点是缺少 gate/triage，而非宣称 56 个均可利用。
- 动态实验仅使用临时数据库/内存 Hono app，临时文件已删除；未修改生产数据库。
- 本报告没有修改任何生产代码、测试、配置、schema 或 migration；唯一报告文件为 `docs/chrona-engineering-review.md`。

## 8. 结论

Chrona 的架构方向、类型系统、测试执行与多平台 release smoke 基础扎实，但当前首要瓶颈已不只是可维护性债务，而是**默认安全、并发所有权、迁移正确性和恢复收敛没有形成 fail-closed 门禁**。P1 顺序应为：先封闭跨源/公开绑定/秘密泄漏；再修 scheduler、session/plan-run、kernel/approval/recovery 的原子状态协议；随后修 migration baseline 与 dependency gate；最后把 lint/boundary 从可交换 warning 池改为新增债务零容忍。大文件拆分应排在这些可验证正确性边界之后。
