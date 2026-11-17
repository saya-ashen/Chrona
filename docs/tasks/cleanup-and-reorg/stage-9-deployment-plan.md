# 阶段 9 chino 受控部署

当前交接（2026-11-17 03:06:36 UTC）：7应用与新unit/package已切换，service active/PID2753388/NRestarts0；最终功能验收未完成，Pi精确commit host身份与旧Apps页面API两项阻塞。下文为已执行的历史计划，不能重新运行launcher、三组固定key或旧备份恢复。真实状态、两条分别精确授权的历史unknown、备份SHA与下一writer方案见[部署摘要](stage-9-deployment-summary.md)文末实际结果和[部署证据](stage-9-deployment-evidence.json)。父要求本轮交接，后续最小源码修复必须正常审查和新clean发行，保持providerHost gate及普通merge语义。

授权：用户“继续部署，不用管它”只解除 `ModuleInvocation 146941c1-2da2-4864-83c4-4b7a8a3aa44d`（sync chat.task-view、unknown、Module event timeout、reply=false）的部署阻断。保存其全部字段的规范 JSON SHA256，前后核对；不更新、删除、重放或换 key。其他 unknown stop/effect、未结算 Run/调用/交付/命令/回调/工作区清理继续阻断。通用 deployment preflight 不修改；本次使用与其相同的完整只读查询和唯一行例外报告。

使用 ponytail 的最小变更原则：复用现有单服务 Nix 声明和正常离线 admin / build / approval 生命周期，不创建第二套授权系统。父负责独立只读审查；worker 不再委托，不 stage/commit。

候选为干净 `caf46efabdf3735bb71ea43302a0566b96f43bdc`，归档 `chrona-linux-x64-caf46efa.tar.gz`，SHA256 `adf5a82ff5998a7b642ea6de5e04d482414bddaa019f0e2054591a75830ebdd1`，47774266 bytes。远端唯一目录 `/home/saya/.local/share/chrona-deploy/cleanup-and-reorg-20261117T0131Z-caf46efa`，本地日志 `.tmp/cleanup-and-reorg/stage-9-deployment/`。全套本地发行门禁已经通过，不重跑。

1. 再次核对真实 PID、exe、resource root、数据库锁、migration checksum、所有未结算状态、9个 active app。归档只复制到私有新目录；解包后核对精确 target、identity、每个 payload 字节和模式。
2. 盘点7个目标的 active commit、local branch、材料及 API/settings/data schema，与现运行包官方 seed 和候选历史分别比较。保留非目标 apps/mcp。不能因 hash 不同推定为本地定制或强覆盖。确认当前7目标与旧官方 seed 完全一致，但候选5个应用无共同历史；先验证普通更新是否受此阻断。
3. 复用旧独立 Nix 单服务 build（既有 nixpkgs/Pi），只调整候选归档身份和标准解包根 `chrona-linux-x64`；保留新旧 unit/package/archive GC roots。禁止整机激活。
4. 停服前再跑完整 guard；临时 `TimeoutStopSec=infinity` 防止超时强杀。正常 `systemctl stop chrona.service`，核对主进程及 cgroup 子进程真正退出，任何未知停止均阻断后续。停止后 `chrona backup` 保存 DB+.tar，私有额外归档 config、Pi profile、runtime resources、work及单元声明；不输出秘密内容。
5. 在全新目录用该备份 `chrona restore` 验证可读性。真实数据不转换、不覆盖。若尚未执行任何真实应用升级，备份后立即恢复原服务，副本演练在离线环境进行，只按真实批准身份启动 Author 处理提交及构建 SDK smoke；停止 supervisor 后再 build，不运行 reconcile/tick、真实模型或QQ连接。普通 `admin install --update` 使用新精确 key；受理后用同版本已有 buildPending/审批流程处理。未知回执只查询原 key。
6. 只有普通生命周期、材料保留及 API/settings/schema 连续性演练全部通过才准备正式停服/备份/目标激活及单 unit 链接切换。真实升级必须基于最后停服的一致备份；不能使用演练副本替换真实数据。无法安全更新时保持原服务并报告实际原因，不绕过 merge 检查或恢复退役 API。
7. 切换后核对实际 exe/resource root/commit、全部 active hashes、原回执字段hash、health/ready、未鉴权401、使用远端现有凭据的鉴权只读核心接口及数据连续性、无意外重启。不得发真实模型/QQ测试消息。启动后可能恢复外部工作，失败保留最新数据；只有另经兼容性证明的代码回滚可用，不自动恢复旧 DB。

普通更新在副本明确返回无共同历史/合并冲突后，改用既有 exact-source Author 提交合同；不改 merge 检查、不伪造祖先、不改旧 commit。Owner 的 `modules.admit` 精确绑定真实已批准 Author 身份、各目标 moduleId 和原 activeHash，完整发行 source 置于 Author 的 `sources/cleanup-deploy-<name>`，由真实 Author `submit` 转发固定材料。每个新 commit 的 tree 必须与发行 tree 相同，保留原版本、历史及数据。

待独立审阅的生产动作清单：最终完整 preflight → 正常排空和停服并核对 PID/cgroup 退出 → 对停止后的原真实DB完整guard并保存本次fresh基线 → 新的一致完整备份及恢复验证 → 任何真实应用写入前再完整guard → 候选宿主离线运行真实 Author submit（notify/pi/qq/web、chat、author/mind 三组，最多四成员）→ 停 supervisor、冻结锁离线恢复调用方依赖并 buildPending → 检查各候选 tests/typecheck/continuity、tree、schema 与固定回执；只有正常自动批准或对应精确 approval 经 owner 解析后才继续 → 核对七目标 active、apps/mcp不变、历史 unknown 原行 hash 不变 → 只切 `/etc/systemd/system/chrona.service` 至已构建候选 unit、daemon-reload、start → 只读部署后验证。Author/Mind 在服务重启前同组激活，避免业务调用经过不匹配的输入合同。任何组失败时不启动候选、不改真实数据库状态凑通过；保留最新数据，原代码是否能恢复由已取得的兼容证据决定。

所有外部动作保存 argv/action、实际开始/结束/退出码和日志；连接超时不等于远端动作失败，不重复启动同一动作，先按 PID/unit/root 观察结果。历史 storage converter、旧 activate.sh 仅供只读理解，绝不执行。

生产唯一外围入口：`sh D/launch-production.sh`（尚未执行；父复核script后启动）。运行根固定为 `D/production-20261117T020346Z-8ce927b2`，包含本次fresh baseline、backup、restore-check、checkpoint与逐动作日志；已存在即拒绝盲目重入。完整argv、环境白名单、失败checkpoint和远端未执行证明见deployment-evidence的 `productionRunnerPreparation`。外围runner失败只正常停服保留最新数据和当前unit，无自动DB或代码回滚。
