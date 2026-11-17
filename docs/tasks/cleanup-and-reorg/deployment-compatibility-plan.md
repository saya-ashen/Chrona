# 部署兼容修复计划

范围：以 a8d4488a 为源码/lint 基线，保留现有 stage-9 部署文档改动；单 writer，不 stage/commit/push、不远端写入、不部署、不碰真实 DB/模型/QQ。生产继续运行。最新部署交接及 stage-9-deployment summary/evidence 为现场依据。

## Pi 精确发行更新

- 在现有 `chrona admin install` 增加 `--exact-release`，要求同时选择 `--update`。仅停服本地 owner CLI 传入宿主内部选择；公开 `modules.install`/Author 输入不变，不公开 `sourceCommit`、路径或 caller 自授。
- 复用 `ModuleInstallation` 固定 requestKey 回执，以内部 mode `exact-release` 区分普通 merge 更新。只从宿主真实 lock/bundle 解析当前固定发行，不接收任意 hash。
- 当前目标必须存在、activeHash 对应真实 approved 版本，实际 Git source tree 与经过校验的发行 tree 一致；存在不同 tree 的未选中本地 source head 时拒绝，防止丢弃待提交定制。保留旧 Git objects、candidate refs、commits 和 activation history。
- 通过现有内部 `propose(sourceCommit)` 进入 normal queue/build/typecheck/tests/continuity/review/activate。将确切旧 hash、versionId、activationId 绑定到候选报告，供排队及异步 build/review/activation 事务复核；改变批准身份后拒绝，不能把原审批扩为 standing grant。不修改 providerHost/resolveExternalRelease 信任规则，不新增 DB 表。
- 真实临时 Git/DB 回归覆盖无共同 ancestry 同 tree、不同 tree、实际批准身份变化、异步/并发、非 owner/伪参数/非发行 hash、旧 history、正常 merge 与批准语义。状态机适用反例复用 invariant harness（毒头不饿死尾、显式新 key 重试、回执交错收敛）；本功能不新增容量配额。
- fake provider 证明激活到精确发行后宿主配置注入及 health，不调用真实模型或 QQ。

## Apps 材料

- 优先读取本地 deployment 副本；必要时仅只读 SSH 获取 `D/apps-current-source` 无凭据源码，保存在 `.tmp/cleanup-and-reorg/deployment-compatibility/`。不修改安装 source 或伪造独立 upstream/history。
- 私有副本最小修改 index.ts：删除退役 component-set 登记，page-set 直接引用现有 `dist/ui.js` 默认 mount、`ui.css`、`props: { view: 'available' }`、原 tools；manifest 删除 component-set uses。core/service/materials 不改。
- 增补 activation fixture，与当前真实 page-set 合同核对；运行原 tests/typecheck/build，保留原材料和最小 diff，为后续正常 Author 候选提交准备精确材料。

## 验证及交付

- 定向先，再完整 verify:slice；使用 8G MemoryMax / 1G swap / Node 6144 / concurrency 2，继承 PATH 和 Prisma engine。正式 verify:release 在持久 systemd runner 中记录 PID/unit/exit/report，超过本轮时间时准确交接，不宣称完成。
- 输出 summary/evidence、命令/日志/实际 exit、生产/测试净行数及未覆盖项。最终报告写入本 run 唯一指定 artifact 路径。父负责独立 review、主仓 commit/clean 新发行及后续部署。
- 既有两个 unknown 原回执/key/hash 不动；不重放、换 key 或扩展例外。后续部署必须 fresh guard、保护 stop、完整一致备份与恢复核验，不能以旧 backup 回滚。
