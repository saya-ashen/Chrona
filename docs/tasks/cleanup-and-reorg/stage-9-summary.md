# 阶段 9 本地最终发行验证

本轮验证目标是干净提交 `caf46efabdf3735bb71ea43302a0566b96f43bdc`，全部源码 SHA256 冻结核对一致。正式构建在写入本阶段受跟踪证据文档之前完成，identity 为该提交 + `clean`；最终工作树仅增加/更新阶段证据。生产源码、测试、合同、生成输入、应用 pin、schema、Nix、锁均零修改，未暂存或提交。

## 实际门禁

- 正式 `verify:release` exit 0：checks、353/353 个实际观察到的 Bun 文件、21/21 个 API 文件、原生 linux-x64 build、packaged runtime smoke 全部 exit 0。未使用失败文件自动重试。完整 Bun 内的平台/真实 Pi 可选 skip 原文保存在 suite-execution.json；API 无 skip。不把文件执行通过当作真实模型或跨平台验收。
- 全库 `lint:warn` exit 1：193 errors / 1029 warnings，历史阶段6为 193 / 1033；ratchet exit 0 只表示零新增债务。正式入口按既定合同单列 lint 债务。
- 完整 `verify:slice` exit 0：430 个输入、97 个关联测试文件，ratchet/typecheck/guardrails（含 boundaries）通过。正式入口与 slice 内部均包含检查，本轮没有额外单独重跑这些门禁。
- Chrome Web shell 60 项通过；Pi/Notify settings 六场景通过，实际尺寸 1440×900、1024×768、390×844，覆盖读取、显式保存、成功/错误、非法保存不覆盖设置、保留草稿及无横向滚动。
- git archive 精确提交的新快照不含 .git、node_modules 或已恢复应用；根依赖和13应用依赖均冻结锁离线安装，13个固定 bundle/material/source/artifact/mode 校验通过，离线原生构建通过。快照如实记录 commit=null / unavailable，不能冒称 clean commit；与正式包的根锁、七个发行模块及998个资源文件字节/模式全部相同。

## 可交付制品

- 冻结归档：`/home/saya/workspace/Chrona-cleanup-and-reorg/.tmp/cleanup-and-reorg/stage-9/chrona-linux-x64-caf46efa.tar.gz`。
- 原始正式构建归档：`/home/saya/workspace/Chrona-cleanup-and-reorg/dist/releases/chrona-linux-x64.tar.gz`，两者 SHA256 相同。
- SHA256：`adf5a82ff5998a7b642ea6de5e04d482414bddaa019f0e2054591a75830ebdd1`。
- 大小 47774266 bytes，归档 mode 0644；identity SHA256 `2ec9ee87a709aa703525d11e7a71f0d695a5f19a5d8a85995d335958c8447b35`。
- identity 记录 Bun 1.4.2 / linux / x64，根锁 `69e3444624b226c23cbc22ff2303b9bc31528b2b73ed0549dbfaf9f4284930fa`，发行锁 `a8d5cf209b0ccf4a832eda00798442dba706ab32a9eddfe2f78e0d287d5b19b8`。
- tar 实际 1102 entries：1000 regular files（999个 payload + identity）、102 directories，无 symlink/hardlink；全部 payload 路径、SHA256、mode 与 identity 一致，无额外普通文件。原生 binary/helper mode 0755。
- 归档解压后在隔离 cwd 通过 `deployment-controls accept --runtime`。可写 Pi 测试副本离线安装其包内 vendor 依赖后，真实 logger、packaged Pi activate/health、shipped fake-provider test-entry 与 guardian 子进程/descendant-stop 均通过；strace 对原主树 packages/node_modules、相邻应用仓库和隔离构建源码均为零访问。

## 原失败与补验

首次 portable probe 虽命令 exit 0，但 trace 发现宿主源码访问，断言使 delivery unit exit 1；不能把这次当作可移植通过。原因是验证副本位于开发仓库下，未执行普通应用依赖安装，继承根 tsconfig paths。只修 disposable harness：原包另复制为可写应用，冻结锁离线安装，并在解压父目录放空 tsconfig，阻断开发别名；仅定向重跑 portability probe，r2 exit 0 且零源树访问。原 r1 JSON、trace、日志及 unit 失败均保留，未改发行字节或生产源码，未重跑已经通过的套件。

stage3 retry150ms、stage6 单轮 Bun 失败与其17项补验组合、stage8 PATH/cc、错误 cwd OOM、环境类型错误的历史证据原样保留。本轮新353文件单轮通过不改写这些历史失败。证据生成脚本首次逐项随机读取 gzip 超时；改为归档顺序读取后完成全部字节/mode 核对，不影响门禁或制品。

## 未覆盖与部署边界

Nix 当前离线 dry-run exit 0，但计划构建745个 derivation（含 bootstrap/toolchain），未启动完整 package 构建或大量下载；已有 Bun version/src override 警告保留。阶段5成功仅为 node_modules FOD，不是整包。Docker daemon 可用，但 `oven/bun:1.4.2-slim` 本地不存在，未拉取或构建镜像。Pi vendor 跨根重新生成的历史绝对路径限制未宣称修复，本轮消费严格固定 artifacts。Standalone Chat SDK lifecycle / Author 实际 admission、macOS/Windows 原生验收、真实账号/模型/QQ消息均不在通过范围。

部署状态 **blocked_by_unknown_receipt**。父协调者只读观察 chino：现服务 active/running、PID1309975、NRestarts0，0001迁移 checksum 与本提交一致；仍有 ModuleInvocation `146941c1-2da2-4864-83c4-4b7a8a3aa44d` 为 unknown、chat/task-view、timeout、reply=false。按既定计划停止部署依赖；不删除、重放或改状态凑通过。该观察不是最终线上验收。本 worker 没有 ssh、停机、真实备份、切换、部署、数据转换、外部写、push 或整机激活。

全部验证进程已结束，无运行中任务。主要 unit / PID：chrona-cleanup-stage9-final / 1748804（通过），delivery / 1893494（r1 portable 断言失败），portable-r2 / 1905258（通过）。均按8G/1G、Node6144、并发2串行执行；成功 transient unit 已卸载，systemctl show 的默认 infinity 不代表运行时配置，实际 argv 见 launch JSON、终止证据见 units-journal.log。开始/结束/argv/exit 在 results、release/report 与 directed results 中；父独立审阅后再处理本地提交，部署阻塞保留。
