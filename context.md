# Chrona 发布准备度只读审计

范围：仅阅读 curated docs、README/CHANGELOG/roadmap、package/CI、运维/隐私/安全文档，并扫描显式 TODO/FIXME/placeholder；未修改文件、未运行重型测试。

## 评分（0-5）

| 维度 | 分数 | 判断 |
|---|---:|---|
| 产品完整性 | 3.5 | 核心 Task→Plan→Schedule→Execute→Review/Recover 闭环及 Goals/Workbench 已有较完整实现；但 CHANGELOG 仍明确 schedule-to-execution reliability、recovery diagnostics、多会话为 hardening，Provider 多数非稳定。 |
| 工程质量 | 3.5 | 分层、contracts、domain purity、typecheck/lint/test、边界与 smoke 门禁较成熟；但历史工程审计记录 P1 指出路由过重、进程内 Map/定时器缺重启语义，且迁移升级 fixture 非不可变。 |
| 发布运维 | 2.5 | 多平台 binary、CI、doctor、backup/restore、升级恢复点很强；但无真正生产部署/高可用/容量/SLO runbook，health 偏 liveness，README/脚本曾漂移，且产品仍 single-user/single-process SQLite。 |
| 数据安全 | 3.5 | 默认 loopback、API_KEY 约束、ACL/权限、日志脱敏、HTTPS provider、备份警示均有；但文档存在 Windows ACL 自相矛盾，且不能公开互联网/多用户，需发布边界声明与安全复核。 |
| 文档 | 3.0 | curated architecture/package/frontend/execution/data/API/docs index 齐全，quick-start/operations/privacy/security 也齐；但 roadmap 明示不少未来工作，历史 audit 发现 docs/scripts 漂移，且文档对 Windows 行为矛盾。 |

## 关键证据与严重性

### 产品
- `docs/en/architecture.md:30-49, ~90-133`：明确层次、Task Workspace、Goals、执行节点和状态语义，说明产品模型完整。
- `docs/en/backend-execution-flow.md:1-80, ~100-180`：端到端路由、计划生成、执行、暂停/失败/恢复及 occurrence 隔离均有具体合同。
- `docs/en/roadmap.md:1-35, ~40-180`：当前 baseline 广泛；路线仍把 schedule-to-execution、统一状态、provider recovery、首次运行列为重点，表示成熟度未达稳定生产。
- `CHANGELOG.md:25-45`：0.1.9 明确“Not a stable production release”；已知限制包括 execution records、schedule reliability、recovery diagnostics、多-session；生产 backup/restore、deployment runbooks、observability、migration safety 曾列 future work。`CHANGELOG.md:1-22` 的 Unreleased 仍持续大范围修复，建议不要将当前工作树当稳定 release。

### 工程
- `docs/en/package-boundaries.md:1-90, ~120-200`：边界、依赖方向、sink barrels 和 contracts 约束清楚；`package.json:25-65` 提供 typecheck/lint/test/CI/boundary/smoke/release scripts。
- `.github/workflows/ci.yml:1-72`：固定 action SHA、Bun 版本、依赖审计、analyze、CI tests、迁移测试、desktop E2E；`.github/workflows/release.yml:1-145`：多平台构建、binary smoke、Windows ACL smoke、SHA256。
- `docs/chrona-engineering-review.md:347-365`：历史审计称生产 TODO/FIXME/空 catch/ts-ignore 为 0；同段仍列结构性风险：路由偏重、复杂度 warning debt pool、scheduler/provider/MCP 进程内状态缺 TTL/重启/shutdown 语义、health 偏“可运行”而非“可安全发布”。这些是 **P1/P2 发布前风险**，需确认是否已修复，而非只看文档声明。
- `docs/chrona-engineering-review.md:~350-357`（ENG-27）：**P2**，`packages/db/src/sqlite-migrations.bun.test.ts:108-168` 使用当前工作树 `0001_initial` 生成 previous-release fixture，无法证明真实上一版本升级；应改为不可变已发布快照/checksum。
- `docs/chrona-engineering-review.md:~338-349`（ENG-26）：**P2**，历史实测 `bun run server:start`/`bun run dev:web`/`bun run start` 与文档/脚本不一致；当前 package 已有 scripts，但发布前仍应重新执行 docs smoke 防漂移。

### 发布运维
- `docs/en/quick-start.md:1-58, ~170-220`：binary/source 两条安装路径、doctor、backup、restore、升级检查和 provider troubleshooting；`docs/en/operations.md:1-95`：VACUUM INTO、一进程锁、pre-upgrade/pre-restore recovery、升级验证步骤完整。
- `docs/en/operations.md:90-95`：明确不支持多用户或多个 server 共享 SQLite、不要直接公开互联网。**中高风险/产品边界**：不能宣称通用生产部署；需发布说明写清单用户、单机、loopback 限制。
- `docs/en/api-reference.md:1-16`：默认 bind/API_KEY/unsafe public bind 规则清楚；health 仅描述“Returns server health”，结合审计所述可能只是 liveness，需 readiness（DB/migration/orchestrator）或明确限制。

### 数据安全
- `docs/en/privacy.md:1-60`：本地数据、provider 外发范围、日志 redaction、无 telemetry、备份/删除/保留期有说明。
- `docs/en/operations.md:14-17`：声称 Windows 新目录会移除继承、仅当前 SID/SYSTEM；`docs/en/privacy.md:14-16`：又声称“Current packaged Windows builds fail closed ... because ... does not yet implement ... ACL”。**P1 文档/安全矛盾**：用户无法判断 Windows 是否可安全发布；必须以代码/CI 结果统一成一种行为，并在 release checklist 验证。
- `SECURITY.md:1-40`：仅支持 main/latest、GitHub private reporting、明确禁止分享 secrets/DB/traces；适合 alpha，但不等于完整漏洞响应 SLA、SBOM/signature/provenance。
- `.github/workflows/release.yml:132-145`：只有 SHA256SUMS；**中风险**：未见签名/证书/attestation，供应链分发信任弱于成熟产品。

### 文档/占位符
- `docs/README.md:1-100`：稳定文档索引、维护规则、命令清单，覆盖面好。
- `README.md:1-180`：版本/平台/binary/source quick start、provider 状态和安全边界清楚；但需保持与 package/CI 同步。
- 显式扫描结果：生产源码未发现明确 TODO/FIXME（grep 命中主要是 UI 输入 placeholder、测试 fixture 注释、历史审计）；`docs/product-ux-audit-remediation-tracker.md:25-60, ~930-940` 仍有大量 tracker TODO/未关闭 checkbox，不应当作发布门禁完成证明。

## 最小发布前清单

1. **阻断项**：解决 Windows ACL 文档/实现矛盾；执行并留存 Windows private-storage smoke，确认真实 packaged behavior。
2. 把 previous-release migration fixture 固定为已发布 artifact/schema fingerprint，验证 fresh install + upgrade 数据保留；不要从当前 `0001_initial` 动态生成。
3. 重跑 docs entrypoint smoke：README、quick-start、architecture 声称的每个命令均存在且可启动；补 CI 自动检查，防 ENG-26 回归。
4. 明确 release scope：single-user、single-process、SQLite/local-only；禁止 public internet；API_KEY、trusted network、备份机密处理写入 release notes。
5. 生产运维最小化：health/readiness 分离（DB query、migration state、scheduler/orchestrator）；定义 graceful shutdown、锁/恢复、日志位置/轮换、磁盘满和 provider outage 处理。
6. 发布供应链：确认依赖审计通过；考虑对 binary、checksums 增加签名/attestation/SBOM；记录可复现构建输入。
7. 仅在 schedule 自动执行、recovery、waiting/approval、provider Tier-1 happy path 完成 targeted tests + desktop E2E 后发布；Beta/experimental providers 标清不支持稳定承诺。
8. 审核 Unreleased 变更、roadmap/UX tracker 未关闭项，建立明确 release acceptance owner；不要把历史 tracker 的 DONE 汇总当验收替代。

## 结构化验收报告

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已对五维成熟度评分，列出 README、curated docs、package、CI、运维/隐私/安全文档和历史审计中的具体路径、行段及严重性，并给出最小发布前清单。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "只读文件审计；未运行重型测试或修改项目文件。"
  ],
  "residualRisks": [
    "Windows ACL 文档与实现行为矛盾（P1）",
    "previous-release migration fixture 动态取当前工作树（P2）",
    "single-user/single-process SQLite，不适合公开互联网",
    "health/readiness、shutdown、持久化重启语义和供应链签名仍需确认"
  ],
  "noStagedFiles": true,
  "diffSummary": "无代码或文档修改；仅写入审计产物 context.md。",
  "reviewFindings": [
    "P1: docs/en/operations.md 与 docs/en/privacy.md 对 Windows ACL 发布状态相互矛盾。",
    "P2: docs/chrona-engineering-review.md 记录迁移升级证据不是真实不可变 previous-release 快照。",
    "P2: 历史文档/脚本入口漂移风险，发布前需 docs smoke。"
  ],
  "manualNotes": "建议将 Windows ACL、不可变迁移升级证明、entrypoint smoke 设为 release blocker；其余按 single-user local-first 产品边界发布。"
}
```