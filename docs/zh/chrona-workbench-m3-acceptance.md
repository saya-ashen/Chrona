# M3 固定本机执行器与有界并行：开发验收记录

状态：**协调者于 2026-11-06 完成 M3 开发集成签收**。M1、M2 与冻结契约 `P2-20261106` 的实现已整合；[统一方案](chrona-workbench-unified-development-plan.md)第 12 节的 19 项矩阵已逐项核对。验收覆盖本机 Linux x64、systemd 262、真实 Hono/SDK/SQLite、独立 Git worktree、Neovim 和受控 fakePi。真实模型、个人设备安装、其他平台原生执行、生产部署和公开发行未包含在本次验收中。

## 实际交付

- 固定执行位置与 owner 授权映射；设备通过原 authenticated poll/report/reconcile 工作，凭据、generation、incarnation、assignment 和原 launchDigest 严格绑定。设备路径保留在设备，服务端不读取设备目录。
- 复用唯一 Run 队列；编码全库 4、每 executor 2、每应用 2 的有界并发。unknown、未确认停止与目录占用继续阻止冲突执行，不自动迁移或重跑。
- 独立工作树、明确 commit 基线和保存文件清单；实际 claim 产生精确 sourceReceipt。依赖消费直接前置的不可变成果，经 SHA、schema、身份、基线校验后才组成有界公开上下文，不自动应用 patch。
- public executor CLI 的 configure、pair、run 和 final-only drain；原 journal 身份在新启动 proposal 被放弃后仍可上传原 final。drain 不获得启动、轮询、续期或新进展权限。
- 原 systemd invocation/cgroup 身份与可信停止观测、prepared provenance、崩溃后不重新启动的 unavailable final 恢复。没有足够证明时保留 unknown。
- owner 独立 workspace cleanup：preview 与 confirm 分离，精确摘要与稳定 commandKey，重查所有权、停止、占用、dirty、集成关系和保护选择。删除结果不确定时跨 key 拒绝重放；持久回执通过原 report 循环上传。
- Workbench v2 创建父子工作、独立叶并行、精确问题答复、不可变文件/原 patch 只读比较、独立接受和清理流程。旧 Pi/v1 路径保留并通过回归。

完成、成果就绪、事件完整、人工接受、应用/合并和删除仍是不同事实。默认保留不触发自动删除，显式保护不能被普通 confirm 覆盖。

## 最终检查与证据

本机证据根目录为 `/tmp/chrona-unified-20261105-c2mdd7yu`；这些路径是本次开发验收材料，不是发行运行依赖。最终主报告为 `M3-final-verification-delivery/report.md`，逐项矩阵为 `section-12-final.md`，实际退出码及失败历史在其 `checks/` 下；`final-manifest.json` 记录证据哈希。

| 检查 | 实际结果 |
| --- | --- |
| 全树 typecheck、required lint ratchet、boundaries | 退出 0；boundary 保留 18 条测试深导入警告 |
| 人工源码 ESLint | 0 errors / 29 条未新增的既有 warnings；精确排除生成器产生的四个合同 bundle，保留初始 raw 失败结果 |
| 完整默认 Bun | 1326 pass / 0 fail / 7 skip，6737 assertions，125 files |
| 完整 API | 61 pass / 0 fail / 3 skip，727 assertions，18 files |
| 默认 runner 遗漏的 source tests | 16 文件各 fresh DB 退出 0；随后新增构建测试 2 pass / 50 assertions |
| 30 天持久边界 | 1 pass / 16 assertions，跨 DB 重开验证；unknown 不被退休释放，cleanup intent/receipt 保留 |
| Workbench 完整 make test | 806 successes / 0 failures / 0 errors |
| 实际 Neovim 键盘 GUI | 1 pass，80.96 秒；真实 HTTP/runtime/SQLite/fakePi/Git，全链及两轮 quiet cursor 重读 |
| Web 三尺寸 | 1440×900、1024×768、390×844 实际页面无横向溢出 |
| 最终 Linux x64 build / release smoke | 退出 0；实际 health、Web root/today 和包内模块类型检查 |
| 最终 binary executor 闭环 | configure/pair/run/CAS、丢 ACK、强制退出与重启、撤权、放弃新 proposal 后原 fence drain，全部实际通过 |

7 个 Bun skip 为非 Windows 的私有目录检查 1 项、可选真实 bwrap 沙箱 6 项。API 的 3 个 skip 为 opt-in GUI 1 项和 bwrap 2 项；GUI 已由 U 独立实际执行，不能将默认 skip 写成重跑成功。其他平台仅通过五目标编译参数回归，未实际构建或验证对应进程停止原语。

## 真实产品与故障闭环

`M3-U-final-acceptance-delivery/report.md` 保存实际 Xvfb/xterm/Neovim 键盘到真实 Hono、SDK、coding、SQLite、PiRun/fakePi 和临时 Git 的证据。父工作含三叶：A/B 在不同工作树并行，C 等待 A 并只消费 A 的公开不可变成果；新 live question 的答复、跨 owner/重复拒绝、原 patch 比较、显式 accept、cancel、server cleanup 预览取消/确认/同键恢复/dirty 保留均完成。设备异步 cleanup 使用 R 的独立真实客户端/daemon/数据库/工作树证据，没有冒充为跨设备 GUI 验收。

`compiled-host-receipt-r5.json` 等材料使用真实完整源 Hono host 和最终编译的 executor CLI；不声称 host 也来自同一个 binary。未手造 running Run、assignment 或 relay handle。首个 final 已提交后故意丢 ACK 并终止 CLI，新 run 经 owner CAS 后 reconcile 原 final，启动计数仍为 1。第二次真实执行撤权、停止后丢失 final ACK，再执行 public run 并以 stdin EOF 放弃新 proposal，public drain 使用原 journal fence 完成 ACK；总启动计数为 2，无重跑。

成果内容、ref SHA、final text 和 capture 均核验。首个 immutable artifact 因 final 提交与强制退出窗口的事件尾缺口保留 `missing=true`；文件 capture 完整不能冒充事件流完整，未覆写原 final 或抹除缺口。

## 独立复核与后续增量

`M3-independent-review/report.md` 记录八项实际发现及逐项关闭证据：pre-final 恢复、never-offered 永久占用、依赖成果上下文、撤权后的 final drain、cleanup/report 并发、已停止记录饿死控制消息、失败启动 proposal 覆盖旧 drain 身份、确定未派发的拒绝导致父取消永久 unknown。独立 probe 使用临时 SQLite、真实 client、journal 和小型 coding fixture；未以作者测试通过数替代源码复核。

最终全业务测试快照之后仅修改发布构建脚本并新增回归测试：发布编译明确将 `NODE_ENV` 与 `BUN_ENV` 固定为 production，防止父测试环境把运行时启动条件静态折叠关闭。该两文件经定向测试、全树类型检查、最终 lint/boundaries、真实重建/smoke 和独立窄审。不得将早期全业务测试称为两文件变更后的全量重跑；production binary 的临时测试隔离由显式私有目录实现，不依赖 runtime `NODE_ENV=test` 数据库保护。

## 版本、产物与保留事项

Chrona HEAD 保持 `8294408fb260f14607b9b3d8199f2b1a8d4e54f8`，Workbench HEAD 保持 `3f633c9ce4855958fc5eed51d465cee4447b1584`；既有 dirty 和本次未提交交付均保留，未 commit、push、stash 或 reset。最终源码清单为 Chrona 696 条记录（含 47 个保留的删除标记）与 Workbench 220 条记录；协调者文档收尾作为单独增量，不冒充已进入 binary。

- Linux binary：`dist/releases/chrona-linux-x64/chrona`，SHA256 `0704fb8d2f4108dcf42bfa9117f8898282fa872e19e519f46e02ba29556253d2`。
- Linux tar：SHA256 `b12855ec58d97a2db8d2535c8c8b9c7997325c62183e2a06bb16bcf81b951482`。
- packaged Web `pages.js`：SHA256 `74cdb74e4c026bffe70f5b9c601c9509e8179aa2323e38f262b60e62de3dd8a3`，包含加载反馈。原列表存在；先前标题截图来自初始加载窗口，不是数据丢失修复。

任务测试终端已逐个读取实际结果、关闭并核对消失；临时 probe 端口与 systemd units 已结束。用户本地私有 preview 是单独保留的轻量试用服务，临时面板不作为正式产品 UI；当前地址、进程及数据保留事实以其私有 README 和对齐报告为准。旧产物、原失败日志和未知状态证据均保留。该开发验收不授权生产升级、模型调用或个人设备接入。
