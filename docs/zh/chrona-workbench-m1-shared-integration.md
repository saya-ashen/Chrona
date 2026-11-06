# M1 共享接线记录

日期：2026-11-05。本文补充已冻结的 `m1-p0-v1`，不覆盖原 P0 patch/manifest；共享交付基于 tree `055b935244fe137dc6c8e552cda9895bef0129d4`。A–E 审核包已按顺序集成，文件散列与接缝变化在交付目录 shared-m1-delivery/integration-receipt.md 记录；运行时最终冻结树为 `1c7ec0a95d0a3f3a6d961133e5f78a89ffdf2f37`（530 文件）；完整开发验证与文档收口已结束，协调者已正式签署 M1 开发验收；[P1 契约](chrona-workbench-p1-contract.md)正在实施、待审核冻结。逐门证据与边界见 [M1 验收记录](chrona-workbench-m1-acceptance.md)。

## 协调者批准的契约增补

通知渠道不再由消息入口的业务 enum 限定。`notificationChannelSchema=z.string().min(1).max(120)`，notificationSchema.channel 和 notify status.chat.channel 统一复用；均非 null。notify 已有未选外部渠道的 `in_app` 和 `bound:false` 保持，投影保留真实登记渠道名；未知名字不能伪装成 in_app。入口 messageSchema/DELIVERY_CHANNELS 不变。批准消息 `msg_9840a4d68a87`；C/D 由协调者统一通知。

`expectedTarget` 为可选严格对象 `{moduleId:string(min1),contractHash:hex64}`，适用于 SDK `CallOptions` 和 routed call params，期望值只收紧目标、不授予权限。同步调用在实际发送前再次复核；异步入队在同事务核对期望并固定身份，重复 key 若与原 binding 不一致返回 conflict。内核闭包 `beforeDelivery?:()=>Promise<void>` 不属于 SDK 对外代码钩子。批准消息 `msg_6bbd7f406fa1`。

异步调用的新入队与 Audit binding 同事务提交；真正缺失的目标用显式 null/null 许可晚绑定，多次确定未发送重试仍可绑定。旧调用无记录不得推断许可；过期 running 仅完整身份、契约及幂等调用允许恢复，其余保留 unknown。暂停的现存目标先固定 moduleId 并尽可能冻结当前契约。批准消息 `msg_4b1d06e276ab`。

## 接线所有权

- B 导出 `createExternalModuleInstaller(ports:StewardPorts):ExternalModuleInstaller` 与 `refreshInstallationReceipts(ports,workspaceId):Promise<void>`。共享 server factory 先构造 ports，再绑定 factory；不创建 Provider。admin 消费同 factory，不重复安装算法。
- 共享 facade 在 buildPending/recoverMigrations/onApproved 完成后刷新回执，初始化前亦刷新；tick 仅有界初始化入队，测试、依赖和迁移检查沿现有后台构建。基础入口不能等待作者测试。
- A 导出 `activateBuiltinReleaseIn(context,tx,release):Promise<Generation>`；初始由 A/B 直接协作；后续协调者另行授权 shared 唯一写者修正暂停更新/显式回滚及数据交换归属，独立 `migration-ownership.patch` 记录，未增并行写者。
- C 页面依赖 modules() 完整目录，list() 不接旧 active/known 集合；shared 已修改用户 lifecycle fixture，保持暂停/删除/备份/归属断言。
- D notify/events 构造器依赖 directory():Promise<{modules,tools}>；shared output-contracts fixture 已接真实 moduleId/hash/contractHash。
- A 完整审核包已包含 supervisor fence；没有重复套补丁。协调者后续授权共享集成树统一消除新增 lint 问题，涉及 A–D 源码的改动另出 lint-integration delta，保持一个写入者。
- callback queue 唯一实现仍为 module-calls.ts，新增恢复回归不会另建队列。内核/应用错误只用于诊断，不能把结果未知变为成功或重跑副作用。

## 集成检查清单

1. 按主协调授权的 provider→consumer 顺序应用审核 patch；每包实际文件/hash 与其基线核验，禁止直接借用未审 worker 目录内容。
2. 真实 installer factory→共享运行 ports→catalog/install→既有构建→审批/迁移→回执→初始化完成；失败和未知按原请求对账，删除预装不复活。
3. 无 mind/QQ credentials/可选 memory 的普通对话；tick 无具体业务协议硬编码，应用上下文仍不可信。
4. 页面/notify/events 目录快照、真实 moduleId、合同 hash 与停用/删除/同名重装回归；paused 隐藏不删除，新 id 不继承旧登记。
5. callback 缺失目标晚绑定、已暂停身份、legacy 无绑定、租约恢复、并发修改与契约变更均有实际拒绝/重试证据。
6. 已完成完整 Bun/API、最终 typecheck/lint、真实浏览器三尺寸与 Linux x64 构建/资源/smoke；协调者已签署 M1 开发验收。P1 仅实施共享契约/测试替身/无模型探针，产品执行与 P2 不在本轮实现。

## 最终开发验证（2026-11-05）

- 冻结运行时交付 `shared-m1-delivery/final-manifest.json` SHA256 `31cc867d1e43822cd1332f4f5025786a0e06436be61987df81fb518f11813349`；该文件、报告及 530 文件 manifest 本轮只读保留，文档 delta 单独交付。
- 完整 Bun：100 文件、1111 pass、0 fail、7 既有环境 skip、5484 expect、无重试；完整 API：11 文件、37 pass、0 fail、2 环境 skip、205 expect。最终 typecheck/lint exit0，仅原 doctor complexity warning。
- C 浏览器：1440×900 / 1024×768 / 390×844、36 状态、无横向溢出；40 个 web 文件与其冻结树逐字节一致。仅隔离发行副本采用验证 bundle SHA256 `2a05949203a6d06b32d2669e0761f76e50ba84cbebbd805c5bb29931a58340c8`，原 pages.js 不覆盖。
- Linux x64 真实 generate/compile、归档逐 SHA 与完整 binary `/health`/web/today smoke exit0；资源 builtin5/external4，模块目录排除 node_modules。发行 tar SHA256 `6fdc795f42c73992a2f724b7eda3eee5bc73b3ecd5645739783f467f2cbbfff3`。
- SDK 最终通过 trusted-local Bun preload 只登记精确 chrona/chrona/testing 入口，目标取内核既有 SDK 复制结果，源码及发行真实进程验证通过。NODE_PATH 在真实模块 tsconfig 下的失败、首轮全组/API/lint/构建失败均保留，不抹历史。
- 迁移在 SQLite writer 锁内核对候选、交换目录及激活；补偿不覆盖新归属。提交前故障注入使用真实 adapter rollback，不等于所有磁盘/提交不确定故障都已覆盖；完整边界见[模块恢复](module-recovery.md)。

以上是开发验证事实，不含旧生产转换/部署、真实模型/QQ/设备、其他平台或不可用 bwrap 环境的验收。
