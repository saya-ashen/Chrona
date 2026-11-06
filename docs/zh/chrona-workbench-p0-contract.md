# M1 P0 契约与交接

日期：2026-11-05。版本：`m1-p0-v1`（`MODULE_CONTRACT_VERSION`）。本文件冻结 A–E 消费的接口；P0 编译通过不等于 M1 完成。用户已授权开始实现，统一方案页首“仅编写方案”为历史授权记录；真实模型、账号、设备、迁移、部署、提交和推送仍无授权。

## 基线

权威源码 HEAD `8294408fb260f14607b9b3d8199f2b1a8d4e54f8`；本工作树 `/home/saya/orca/workspaces/Chrona/chrona-p0-contract` 同 HEAD。用户 patch SHA256 `0954ff1bb7d87f41496178fce5c8647323d57e85365bc3c797fb72cabdcd2763`，先 apply --check，再 apply，按 snapshot manifest 还原四个 untracked；13 文件 SHA256 全部一致。来源未修改。交付 worker patch 扣除该完整基线，binary-safe；`baseline.json`、用户原 patch 和 untracked 快照仍独立保留。用户 `pages.js` 保持原字节，未生成或手改。

## 身份、名单与操作

权威 schema：`packages/contracts/src/steward/module-lifecycle.ts`，经 `index.ts` 导出；engine 身份 helper 为 `module-identity.ts`。

| origin | 名单 | 动态代码操作 | 其他操作 |
| --- | --- | --- | --- |
| kernel | chat/modules/schedules/provider/approvals/settings/secrets/activity/content/memory；executions 仅保留名 | 全拒绝 | 按实际系统 settings 声明 configure；不可暂停/删除 |
| builtin | web/mcp/files/notify/events | build/propose/group/activate/update/rollback/remove/install 全拒绝 | enable/disable/diagnose；有 settings 才 configure |
| external | 官方预装 qq/remind/mind；可选 memory-local；未来 coding/editor；用户应用 | 受检 build/propose/group/activate/update/rollback；remove 仍需审批与关联检查 | enable/disable/diagnose/configure；install 是目录动作，不是已安装行的能力 |

保留名为内核名、五个发行内置名和独立救援入口 rescue；无 DB 行也拒绝外置占用。coding/editor 冻结为可选外置名称，不安装、不创建设备表、不实现 executions 接口。

应用类别唯一来源为 `Module.builtin`；`ModuleVersion.source`、manifest、目录或 hash 不授予类别。外部 manifest 的 builtin/origin 字段由现有 strict schema 拒绝。数据库中 builtin=false 却占保留名是 identity conflict，不能当普通外置。`moduleIdentity(row, {configurable?,removable?})` 投影 origin 和生命周期 `capabilities`；它不代替执行端事务校验。`overview.permissions.capabilities:string[]` 保持现有权限说明，绝不被生命周期对象覆盖。`appSchema`、`modules.list`、`overview.app` 使用相同身份；系统 overview/system 投影 kernel 身份。

精确 helper：

```ts
moduleIdentity(row: {name:string;builtin:boolean}, options?: {configurable?:boolean;removable?:boolean}): {origin: ModuleOrigin; capabilities: ModuleCapabilities}
assertModuleOperation(row: {name:string;builtin:boolean}, operation: ModuleOperation): void
assertExternalName(tx: Prisma.TransactionClient, workspaceId:string, name:string, operation:ModuleOperation): Promise<Module|null>
assertExternalModule(tx: Prisma.TransactionClient, workspaceId:string, moduleId:string, operation:ModuleOperation): Promise<Module>
assertDynamicModuleActivation(tx: Prisma.TransactionClient, workspaceId:string, moduleId:string|null, payload:Prisma.JsonValue): Promise<void>
```

PrismaClient 满足所需 transaction client 结构。A 在排队前、执行依赖/测试/迁移前、创建候选前和最终提交/审批恢复事务逐次使用；P0 已收紧 facade.activate 与旧审批 helper，重命名旧 assertBuiltinUpgrade 调用。普通/restore 审批一视同仁，不能绕过。可信发行注册独立于动态 activateIn；不得传一个公共 `allowBuiltin` 布尔开关。

错误保留现有路由 code：`forbidden` + helper.reason `immutable_module/reserved_module_name`；`conflict` + `module_identity_conflict`；未知模块 `not_found`。发行 `not_found/release_not_found`、`invalid/invalid_release`、不安全路径 `forbidden/invalid_release`、漂移 `conflict/release_drift`。错误 message 供人读，不能解析中文消息控制逻辑。当前路由只保证 code/message；helper/安装回执还提供 reason，A/C 不可假设所有路由错误均有 reason。

删除 M1 由 A 在申请与备份后最终事务复核：显式 active uses 依赖、活动 Session.moduleId/entryModuleId、关联 queued/running Run、Audit.build_request 目标、未结或 unknown ModuleInvocation/ModuleCall、未处理 reply 回调。冲突返回 `conflict` 与具体阻碍/下一步，不删历史/未知结果。已结束且无运行/回调的历史不永久阻止删除，历史归属沿现有 SetNull/无 FK 字段保留，不推断同名新实例。entry 判定沿 isEntryModule，不把 mind 假定为非入口；首版可保留现有 entry 删除限制，放宽需有完整活动关联覆盖。

## 发行与安装边界

```ts
type ModuleRelease = {name:string;origin:"builtin"|"external";codeDir:string;hash:string;manifest:ModuleManifest};
resolveBuiltinRelease(ports: Pick<StewardPorts,"moduleBuiltinResources">, name:string, expectedHash?:string): Promise<ModuleRelease>
resolveExternalRelease(ports: Pick<StewardPorts,"moduleExternalResources">, name:string): Promise<ModuleRelease>
installExternal(ports:StewardPorts, workspaceId:string, request:ModuleInstallRequest): Promise<ModuleInstallResult>
ensureWorkspaceInitialized(ports:StewardPorts, workspaceId:string, options?:{retryFailed?:boolean}): Promise<ModuleInitializationState>
recordInstallationResult(ports:StewardPorts, workspaceId:string, result:ModuleInstallResult): Promise<void>
externalPackageCatalog(ports:StewardPorts, workspaceId:string): Promise<ModulePackageCatalog>
```

可信 root 仅来自 host ports。源码资源为 `steward/builtin`、`steward/external`；发行包为 `resources/builtin`、`resources/external`。显式 CHRONA_RESOURCE_DIR 或存在发行 resources 时，缺资源不能回退源码树。resolver 检查固定名单、目录、符号链接、manifest.name 与 schema；复用 readModuleFiles 的依赖目录排除，排序后每文件 path + NUL + 原始 bytes + NUL SHA256。只读/硬链接发行资源允许读取，不能写。expectedHash 不符拒绝，不从旧 store 兜底。manifest.packages 为依赖声明；本机依赖/数据兼容是 B 注册职责，不在解析时执行依赖安装。

A supervisor 使用真实 Module.builtin 选择 resolver 或外置 store，启动前核对发行 hash/manifest；builtin 故障只重启/暂停/诊断。B `registerBuiltins` 改为固定五项轻量可信绑定，不经 proposeBuiltin/buildPending，不遍历任意子目录；B 负责写合法 approved 发行元数据、generation、静态日程、activated 事件和数据兼容检查，A 配合底层可信切换 seam。该注册实现属于 B，P0 尚未替换旧 registrar，故 P0 不代表不可变发行已端到端可用。A/B 集成时删除旧 preserveCustomization/custom-builtin/proposeBuiltin 与旧测试预期；不得为了先跑旧测试保留双轨。

安装请求严格 `{package:"qq"|"remind"|"mind"|"memory-local",mode:"install"|"update",requestKey:string(1..120)}`；不接受宿主路径、caller、builtin 或任意包 URL。本地源码仍 propose。install 遇已有行 conflict，update 遇无行 not_found；重复 requestKey 同输入返回原回执，不重跑；不同包/mode conflict。失败重试必须明确新 requestKey，未知/处理中保持原 key 查询，不自动再执行。

回执 `{package,requestKey,status,moduleId,hash,approvalId,error}`；status 为 pending/building/pending_approval/installed/failed/unavailable，error 为 null 或 `{code,reason,message}`。pending 表示持久接收或中断尚未核实，不代表已提交/已安装；building 只代表现有构建队列已提交；installed 仅 A/B 确认已安装的事实，不保证 credentials 配好或当前进程健康。待配置从凭据元数据/模块诊断派生；不能把 QQ 缺凭据当安装成功运行失败混为一谈。未激活/失败候选保留真实 Module/Version 行在 list；尚无 Module 的失败在 catalog.installation，不制造虚假应用行。

`StewardPorts.moduleExternalInstaller?: ExternalModuleInstaller` 精确为：

```ts
type ExternalModuleInstaller = (input: {
  workspaceId: string; request: ModuleInstallRequest; release: ModuleRelease
}) => Promise<ModuleInstallResult>;
```

B 适配器只从受信 release 私有复制/入队现有 propose（source=user），使用 A 的检查、迁移/凭据审批和激活流程，不建第二套算法、不在入口内执行测试/依赖安装。P0 未接适配器时真实返回 unavailable/installer_unavailable；不得把 mock 验证说成安装闭环完成。B 独占回执刷新：适配器提交后记录 requestKey 与真实 moduleId/hash 的对应；在其 module-install.ts 实现 `refreshInstallationReceipts(ports:StewardPorts, workspaceId:string):Promise<void>`，从现有 ModuleVersion 状态/Module.activeHash/审批事实推导 building/pending_approval/installed/failed，调用 `recordInstallationResult` 写回。协调集成在每轮轻量初始化读取前以及现有 buildPending/recoverMigrations/onApproved 完成后调用该刷新，不由 A 复制回执算法。A 只保证现有版本与审批事实正确；B 从这些事实恢复，不能依赖丢失的内存 callback。approved 且非当前 active 不能伪称 installed-active；暂停应用更新不得暗中恢复。P0 未实现该刷新，B 必须交真实 building→审批→installed/failed→初始化 complete 的跨包测试后才能验收 M1。

持久安装回执：Audit `kind=module_installation`，ID `module-install:sha256(workspaceId + NUL + requestKey)`，details `{request,result}`。与 Module 删除无级联。事务先 claim pending，再调适配器；pending 中断不盲目重提，B 必须核对已有 proposal/版本/提交审计后更新该回执；请求接收与实际副作用原子性不靠内存判断。catalog 只读固定四包可信资源、moduleId、最近回执、资源错误；claim 同事务 upsert 每 workspace/package 的固定 Audit 指针（kind=module_installation_latest，details.installationId），catalog 精确读取指针与对应回执，不扫描有界全局窗口，不会因其他包历史增长丢失最新状态。

初始化：Workspace.settings.moduleInitialization（version=1），先持久固定三项，每项 requestKey/attempts/status/moduleId/hash/approvalId/error。既有应用 skipped 不覆盖；pending/building/approval 查询原 key；failed/unavailable 默认不重试，仅 `{retryFailed:true}` 新 attempt/key；installed/skipped 不补。全部 installed/skipped 才 complete，complete 永不重新扫描补装；pending 中已记录 moduleId 被删除也 skipped。并发同 DB/workspace 共享 promise，DB 唯一安装回执保护重复提交；正式服务依现有独占 SQLite runtime lock，无第二写服务。状态损坏 fail closed，不重置账本。B 接入持久回执对账并解决适配器副作用窗口，不自动重跑 owner build。

P0 的 initialization 是可调用边界，没有在 tick 调未配置适配器；B 实现适配器后，协调集成把 `ensureWorkspaceInitialized` 安排在轻量 registerBuiltins 后，仅做有界入队；后台沿现有 startBuild/buildPending。基础入口/tick 不等待安装检查。`createModuleRuntimePorts(db,{dataDir?,now?,sandbox?})` 位于 server runtime，仅装配 SDK/typecheck/packages/sandbox/可信资源，绝不创建 Provider/listener/tick。admin install 共用该 factory 和 installExternal，仅入队并提示重启，不借 admin-build 起真实 Provider；B 正式适配器必须由同 factory 和服务装配共用。program 已注册 catalog/install --update --request-key，rollback 只接受 hash。

## 回调与扩展登记

`modules.list` 提供 id/name/status/activeHash/origin/capabilities；`modules.tools` 的外置/内置工具额外提供 moduleId/hash/contractHash，已有输入/输出/visibility/idempotent 字段保持。`moduleCallbackContractHash(tool)` 固定输入 JSON schema、输出 schema/null、排序 visibility、idempotent 的 SHA256；代码 hash 变化但接口相同可继续，接口改变必须重登记。

P0 在 enqueueCall 同事务写 Audit `module_invocation_target`，ID `module-invocation-target:<invocation.id>`，details `{moduleId,contractHash}`；投递复核相同 ID 与契约。同名重装、契约变化均 failed/conflict，不投递新进程；原 callerModuleId 消失也拒绝，不降格 kernel。目标确实不存在的 kernel/lenient 调用可首次投递绑定；已有暂停模块先绑其 ID。旧无 binding 且已经尝试的调用拒绝；没有数据迁移/猜归属。已有 unknown 的幂等与非幂等重投边界保留，身份变化不能借 idempotent 换目标。

D/C 的页面、渠道、订阅记录必须保存 caller.moduleId/回调 moduleId、contractHash 与自有 revision；停用隐藏/停止新投递、保留登记；删除按真实 id 清理；同名新 id 不能接管；更新回滚不兼容时明确重登记。notify 发送 attempt 持久固定 owner/tool，不能因 enqueue 回执丢失重新选可变 channel；events 旧回执不能删新 revision。具体登记业务归 C/D，P0 不复制其表或队列。shared notify-user 未知 channel 投影、共享输出测试旧名单由 M1 集成处理。

## Fixtures、接线与验证

`module-lifecycle.fixtures.ts` 导出 builtin/external/第二外置/同名重装/kernel/预装/可选/伪造 manifest+row/失败和未知安装/回调变更 fixtures；无真实账号或执行资源。`module-p0-contract.bun.test.ts` 用临时 DB/合成发行目录和有界 fake adapter，覆盖操作矩阵、空 DB 保留名、事务身份复核、发行 hash/漂移/符号链接、安装去重、失败、并发初始化、不复活、回调拒绝和投影。

```ts
const release = await resolveBuiltinRelease(ports, "web", row.activeHash!); // A supervisor, no store fallback
const installation = await createModules(ports, workspaceId).install({ package: "qq", mode: "install", requestKey: "owner-explicit-001" });
const state = await ensureWorkspaceInitialized(ports, workspaceId); // B after queue adapter is wired
// Fake adapter for independent tests only:
ports.moduleExternalInstaller = async ({request,release}) => ({package:request.package,requestKey:request.requestKey,status:"building",moduleId:null,hash:release.hash,approvalId:null,error:null});
```

测试 runner：engine 局部用 `bun test <*.bun.test.ts>`；模块作者测试保持各自 `test.ts` + chrona/testing fake kernel，不能调用 QQ/模型。四目录移动后 QQ 公共 imports、tick/reflection fixture、typecheck resource 和 release/docker smoke 路径已机械修正；test-entry 根据固定名单挑 builtin/external。旧 remind/memory 注册测试不再代表目标语义，归 B 更新；builtin-output-contracts 旧名单归集成；不删除失败断言冒充通过。

## A–E 精确写入白名单

以下生产/测试路径均相对仓库；未列共享文件、新 helper、fixtures、锁和 pages.js 禁写。确需追加先向协调者报告。

| 包 | 允许文件 |
| --- | --- |
| A | steward/module-{proposal,build,build-session,activation,generation,supervisor,remove,status,group,migration,evolution}.ts；局部 migration 仅身份复核；对应同名 .bun.test.ts；新增 module-identity.bun.test.ts、module-remove.bun.test.ts。module-build-helpers/build-process/continuity 不预先扩权 |
| B | steward/module-builtin.ts、module-release.ts、module-install.ts、module-initialization.ts 与对应 .bun.test.ts；packages/cli/src/admin.ts、admin.bun.test.ts；必要新增 admin-install.ts/admin-install.bun.test.ts。registerBuiltin trusted seam helper 只能在上述 B 文件内，A 如需底层 generation 接线由 A 单写 |
| C | steward/builtin/web/** 源码/测试/样式/文档，排除 pages.js、bun.lock、node_modules；保留全部用户 Web patch |
| D | steward/builtin/{notify,events,files,mcp}/** 与对应 builtin-{notify,events,files,mcp}.bun.test.ts；禁止 shared facade/SDK/队列 |
| E | steward/external/{qq,remind,mind,memory-local}/**；builtin-qq-{attachments,bot,official}.bun.test.ts（仅 QQ 局部）；禁止共有 test-entry、注册生命周期测试与 root 配置 |

表中 steward=packages/engine/src/modules/steward。A 用户 baseline module-lifecycle.bun.test.ts 由协调者 M1 集成单写，不能覆盖。B 同时接管 builtin-remind.bun.test.ts、memory.bun.test.ts、module-builtin.bun.test.ts 的发行/安装 fixture；A/B 共享 integration 场景由协调者追加跨包测试。C/E 需要 author runner 资源缺依赖时报告，不联网升级。P0 shared files、module-p0-contract.bun.test.ts、module-calls.ts/tests、ports/server/program/build manifest、docs/AGENTS 均仍由共享集成负责人单写。

## M1 未完成与验收门

A 全动态入口/可信 supervisor/组回滚/删除关联；B 真实 registrar、installer adapter、pending 中断对账与检查回执更新；C/D/E 所有应用业务和登记生命周期；shared tick 接线、notification projection、全套旧测试语义更新、发行 smoke、浏览器、全库 lint/test/API 均待 M1。P0 不实现设备、执行器、coding/editor 或详细事件流。最终 P0 实际命令、句柄、退出码、日志和 patch SHA 记录在交付目录 report.md/manifest.json；以这些运行证据为准。
