# M3 签收后的 pre-push lint 修复（2026-11-06）

基线 `platform-v2@73339094`。这是签收后的新增代码修改，不追溯修改旧验收结论；此前构建的 binary 不覆盖本次源码或新 `pages.js`。未提交、未 push、未部署，persistent private preview 未重启。

## 修改边界

- `notify/registry.ts`：按 delivery variant、属性及输入协议拆分；用 `Partial<Record<…>>` 表达字段可缺失，保留运行时 schema guard。
- 安装 UI：提取存储读取和按钮文案；可缺失的 `sessionStorage` 显式标为可选，原确认、请求 key、恢复与回执行为不变。
- 执行显示、cursor、存储：提取 tool display、cursor 格式解码、模块调用方复核、分页边界/持久事件校验及 long poll；校验顺序、配额、事务和错误优先级保持。
- 安装/初始化/发行：按复制、提交证据、审批事实、回执恢复及 manifest/目录校验拆分；保留失败和未知结果处理。
- remind 作者测试：仅移除断言后确定非空值上的 optional chain。
- `eslint.config.mjs`：仅精确忽略 `build/execution-contracts.ts` 生成的下列四个目标；不改规则、ratchet baseline 或 hook：
  - `packages/engine/src/modules/steward/external/coding/contract.js`
  - `packages/engine/src/modules/steward/external/coding/executor-contract.js`
  - `packages/engine/src/modules/steward/external/editor/contract.js`
  - `packages/engine/src/modules/steward/external/editor/executor-contract.js`

没有修改 Workbench、共享契约、schema、依赖、部署或执行语义。

## 本次真实检查

指定 Bun `1.4.2`，专用 Orca terminal，串行 `systemd-run --user --scope`，`MemoryMax=8G` / `MemorySwapMax=1G`；临时 private SQLite 由 `scripts/init-sqlite-db.ts` 初始化。未使用个人数据库。

- 定向 ESLint（全部修改源码/测试及配置，`--max-warnings 0`）：通过。
- `bun run typecheck`：通过。
- notify registry/lifecycle/runtime、web lifecycle、execution events/projection/store、module install/P0/activation registration：10 文件，93 pass / 0 fail，476 assertions。
- 新增 schema 缺字段拒绝、cursor 格式/lifecycle 错误先于引用冲突的回归测试。
- `builtin/web` 的 `bun build.ts`：通过。
- `git diff --check`：通过。

完整 pre-push/local CI 和 commit/push 由协调者接续；未重建发布 binary、未重新运行浏览器三尺寸验收。本次 UI 为行为保持重构，不能把旧 binary 或原预览作为新 bundle 的验收。

## SHA256

`builtin/web/pages.js`：

- 修改前：`74cdb74e4c026bffe70f5b9c601c9509e8179aa2323e38f262b60e62de3dd8a3`
- 重建后：`8323d8f7a07841532558a8d4786ac819eb2b04a93dafe519460a725abd50c6c3`

四个 contract bundle 内容未改；coding/editor 对应文件哈希相同：

- `contract.js`：`7873fd3add250f515a2a12a8966c1818655a15577fdbc4bed1170aa22b156f2a`
- `executor-contract.js`：`37ed61334086464886a51324cb34f298c3a4b7bd3dbfdeb5ad568f015ac4f08e`

原失败证据保留：`/tmp/pi-bash-acb764b0d6c9e251.log`。本次日志：`/tmp/chrona-push-lint-{targeted,typecheck,tests,web-build}.log`。
