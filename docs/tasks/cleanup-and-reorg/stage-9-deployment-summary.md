# 阶段 9 chino 部署进度与恢复入口

截至 2026-11-17 03:06:36 UTC，实际7应用正常Author升级和单unit/package切换已执行；`chrona.service` active/running，PID `2753388`、NRestarts=0，当前为byte-preserving候选包。HTTP、鉴权、精确资源、旧业务数据和Mind页面登记验证通过，但**阶段9尚未完成**：Pi同树新commit不满足精确发行commit的host注入合同，Provider不可用；保留的旧Apps仍调用已退役`web.component-set`，应用中心登记失败。父要求本轮交接，随后由唯一writer实现显式精确发行更新入口及Apps正常页面迁移，再构建验证新发行。当前保持服务运行，无回滚。下文旧“未执行/等待”段落为历史准备记录，以本段和文末实际结果为准。

远端根 `D=/home/saya/.local/share/chrona-deploy/cleanup-and-reorg-20261117T0131Z-caf46efa`；本地原始动作、argv、时间、exit 和脚本位于 `.tmp/cleanup-and-reorg/stage-9-deployment/`。结构化证据见同目录 `stage-9-deployment-evidence.json`，详细行动约束见 `stage-9-deployment-plan.md`。

## 已取得证据

- clean 发行 `caf46efabdf3735bb71ea43302a0566b96f43bdc`，归档 SHA256 `adf5a82ff5998a7b642ea6de5e04d482414bddaa019f0e2054591a75830ebdd1`、47774266 bytes；上传后精确核验 identity、999个 payload 的字节、模式及完整清单。没有重跑已通过本地发行门禁。
- 全量普通 guard 查询通过唯一历史 receipt 例外。迁移 checksum 与候选相同。全行 hash 始终为 `b040fb97f9fb039bdf13f643446f0b43b26dbe06c1b8e7bf343f525ef9d0dac8`，未删除、修改、重放或换 key。
- 只构建既有独立 Nix 服务，保留新旧 package/unit/archive GC roots；未整机激活、未切换 live unit。
- 01:36:06—01:36:43 UTC 正常停服、证实原 PID/cgroup 真正退出，完整 `chrona backup` DB+.tar，加 config/Pi profile/runtime resources/work、环境文件与原 unit/declaration 私有备份。全新恢复目录 quick_check=ok。随后恢复原服务。健康、ready、未鉴权401与远端现有凭据鉴权只读 today=200已验证。
- 原9应用均与旧官方包种子及其文件一致，但种子自身继承既有定制，不能解释为不存在历史定制。五应用与新发行无 Git 共同历史；Pi只有生成描述符冲突，Chat可正常合并。普通 `admin install --update` 六条 durable receipts 实为 failed/submission_not_started，命令 exit 0不等于更新成功。旧 merge 检查未放宽。
- 改用既有正常 exact-source Author 合同：owner admission 精确绑定实际已批准旧 Author、目标 id 和原 activeHash，调用真实 Author submit；三组为 notify/pi/qq/web、chat、author/mind。新 commit tree 与已审发行 tree 逐一相等，旧 commit 未改写。
- `material-rehearsal-r4` 在恢复副本正常冻结锁离线补齐旧调用方依赖后，全部7应用 typecheck/tests/continuity通过，schema不变、migrated=false。既有同权限正常规则自动批准三组并全部激活；无额外新 approval卡需要解析。Author/Mind同组激活。非目标 apps/mcp不变。unit `chrona-cleanup-reorg-material-lifecycle-20261117-r4.service` exit 0、01:56:00 UTC完成，现已结束，无运行中部署任务。
- 连续性检查：122应用数据文件、4709旧content文件、440旧源码文件字节不变；63 Run、63 AgentCommand及execution和migration表全部行不变；9旧commit保留。9份 `.chrona-restore.json` 按正常restore合同生成新的代次，单列报告，不冒称逐字节不变。

## 原失败保留

首次备份 transient unit因错误Python绝对路径启动失败，随后使用实际profile Python通过。Author演练r1 admission错误携带wire-level requestKey，被正常输入校验拒绝；r2材料目录不符合 sources/package合同，被真实Author拒绝；r3已激活5应用，但省略node_modules的恢复副本令旧Mind调用方检查缺zod，Author/Mind整组拒绝。仅在全新r4正常冻结锁离线恢复依赖后重演相关步骤，完整通过。r3 restore调用本地25秒超时，远端完成日志后确认完成，不重复restore；该次wrapper无法取得原exit，明确保留证据缺口。连续性首轮把正常restore marker当业务字节而失败，核对sqlite-backup.ts定义后明确单列9份marker并复验通过。

## 下一步与失败策略

独立review通过后，按plan再次完整guard、正常排空和停服、建立新的完整一致备份与恢复验证，再运行真实目标生命周期。不得以旧backup或r4副本替换生产数据库。准备但未运行的 `material-production.ts/.js` 是r4同路径的生产特化：只接受精确生产dataDir/databaseUrl，读取停服后 `D/production-20261117T020346Z-8ce927b2/production-before.json`，且对照原演练baseline拒绝目标hash/schema变化。外围动作现已由 `production-runner.py` 与 `launch-production.sh` 实现，但尚未执行；必须经父复核后从唯一launcher启动，不能单独启动该helper。

固定生产key前缀为 `cleanup-material-production-20261117T0131Z:g1`、`:g2`、`:g3`，每组分别 `:admit`、`:author-submit`、`:submit`。未在生产使用。未知结果只查询原固定key；不得重新生成key或盲目重跑helper（材料目录存在即失败）。每组生成的hash需重新记录，不能把副本commit当生产commit；精确tree/materialDigest才是已审内容。

失败保留最新真实数据、当前unit/PID/步骤与原始回执；不得自动恢复旧数据库或把候选状态改成通过。启动新服务可能恢复正常外部工作，之后代码回滚也必须先证明兼容最新数据；原包与GC root是保留入口，不等于已证明可无条件回滚。没有真实模型调用、QQ测试消息、旧converter/activate.sh、push、commit/stage或整机激活。

## 生产外围 runner 补齐（未启动）

截至 2026-11-17 02:11:30 UTC，已上传脚本但未启动。新运行根 `D/production-20261117T020346Z-8ce927b2` 尚不存在；transient unit `chrona-cleanup-reorg-production-8ce927b2.service` 为 not-found/inactive/MainPID0，生产仍原PID2576846、NRestarts0、原exe。SHA及远端证明、精确argv和环境白名单已写入deployment-evidence的 `productionRunnerPreparation`。

`state_guard.py` 抽出与原preflight逐字一致的12项DB查询，不依赖PID；live preflight继续核对真实proc/data/resource。runner确认原PID/cgroup退出后，对原DB再完整guard并保存本次fresh `production-before.json`，建立本次 `backup/before.db`、`.tar`、`external-roots.tar`，在本次 `restore-check` 验证DB及附加根真正解包/字节连续性。任何真实应用写入前再次完整guard。

服务持续停服直到七app normal Author流程、精确tree/build/批准receipt、apps/mcp保留、schema不变、真实数据及历史unknown全行hash检查全部通过。随后仅切精确unit；unit的ExecStart和pre-start资源复制源须对应同一已核对发行package，启动后再验证实际exe、resource文件及执行位、active hashes、旧业务行、health/ready、未鉴权401、鉴权只读today与无重启。失败分支正常停服，记录失败step及实际exit，保留最新DB和当前unit；没有无条件旧代码启动、DB恢复或自动代码回滚。

临时验证6个test methods通过，覆盖13类guard反例、完整顺序与fresh基线、停止窗口新增unknown阻断写入、启动后验收失败只停服保留数据/unit、附加根实际解包。Python/shell及已有私有helper TS/JS语法通过；未重跑r4或发行构建。helper仅同步fresh输出路径和baseline检查至已有私有JS，无发行字节变更。

978aa3b8复核已关闭原两P1，新增唯一收尾失败停服P1已最小修补：任一failure-stop前重新安装保护drop-in、daemon-reload并核对 `TimeoutStopUSec=infinity`、`SendSIGKILL=no`、`Restart=no`；任何一步失败只记录现场，不发stop。临时测试现8个methods通过，新增覆盖恢复正常策略后的属性断言/checkpoint失败、保护install/reload/属性验证失败不stop。新SHA和远端未执行证明已更新；仍待父窄复核，未launch。


## 实际入口第一次执行与单包集成阻塞

父已关闭所有runner review P1并允许执行，02:21:29 UTC唯一入口启动一次，但 `verify_release` 在停服前正确拒绝旧Nix声明的autoPatchelf产物：chrona与guardian两ELF字节改变。checkpoint记录stopRequested=false、candidateStartRequested=false，生产PID2576846/旧包/9应用未变。旧P/unit保持失败原状，未重启原固定key。

父授权修复byte-preserving单包集成：另建 `D/declaration-byte-preserving`，移除autoPatchelfHook、dontFixup=true、保留dontStrip和原归档；不改旧store或发行字节。原ELF解释器 `/lib64/ld-linux-x86-64.so.2` 存在并由主机nix-ld提供。已准备全新data/隔离cwd的运行时启动、Web/Pi首次正常激活、health/ready/鉴权只读、真实guardian子进程stop与shipped fake-provider smoke，但尚未执行。

本次nix-build PID2673644、daemon2673676阻塞于Btrfs metadata reservation（只读kernel stack），日志 `D/logs/nix-byte-preserving-build.log` 尚无构建结果、候选outlink未生成。只读容量：设备未分配仅1MiB，Metadata DUP 97.27%已用；df估计尚余77GB。已向父报告基础设施阻塞，未执行balance/GC/删除。生产仍active/running/PID2576846/NRestarts0；本次新候选未完成字节/runtime证据前不再launch生产。


## Byte-preserving集成已通过，等待r2入口窄复核

Btrfs预留等待已自行解除，没有balance/GC/删除。新包 `/nix/store/bc16dh9fhsnqwja504lxj3xjgdn76hg7-chrona-0.3.1-cleanup-caf46efa`，新unit `/nix/store/cbakrsg9jnc29hy6srf8p6wvinwgc8iy-unit-chrona.service`，GC roots `D/package-byte-preserving-root`、`D/unit-byte-preserving-root`。999payload字节、完整清单、identity精确一致，读取/执行位一致；Nix store去写位按规则单列，未将ELF改写当作原字节。

隔离runtime首次因fresh HOME缺Bun cache，Web依赖安装在禁网环境等候后150秒门禁失败，原日志/失败unit保留。仅harness显式指定已有BUN_INSTALL_CACHE_DIR后用全新临时目录重验：unit `chrona-byte-preserving-smoke-8ce927b2-r2.service` exit0、02:46:44 UTC完成；实际server、Web/Pi首次正常build/激活、health200/ready200/未鉴权401/鉴权today200、真实guardian子进程和descendant-stop、Pi activated/health、shipped fake-provider全部通过，无真实模型/QQ。未重跑应用r4或发行全量门禁。

r2仅另存唯一 `production-runner-r2.py`、`material-production-r2.ts/.js`、`launch-production-r2.sh` 与fresh P `D/production-20261117T0243Z-8ce927b2-r2`，选择 `paths-byte-preserving.json`；执行前保存第一次attempt明确stopRequested=false/candidateStartRequested=false原checkpoint，固定appkeys不变且未曾使用。runner相对已审版本只有fresh路径、精确新包paths、helper路径及原not_started证据4处改动；保护stop和DB guard未改变。02:47:25 UTC freeze证明r2 unit not-found、fresh P不存在，生产仍原PID2576846/NRestarts0。完整SHA及runtime结果在deployment-evidence.bytePreservingR2Review和 `D/byte-preserving-r2-review-freeze.json`，本地 `production-r2-review.diff` 可直接窄核。r2未launch，须父窄复核后再执行。


## 实际部署与最终运行交接（2026-11-17 03:06:36 UTC）

生产运行根 `P=D/production-20261117T0243Z-8ce927b2-r2`；DB仍为 `/var/lib/chrona-pi/data/chrona.db`，没有恢复真实DB、数据转换或自动代码回滚。实际exe：`/nix/store/bc16dh9fhsnqwja504lxj3xjgdn76hg7-chrona-0.3.1-cleanup-caf46efa/libexec/chrona/chrona`；unit link：`/nix/store/cbakrsg9jnc29hy6srf8p6wvinwgc8iy-unit-chrona.service/chrona.service`。GC roots保留新旧包/unit/archive。未执行整机NixOS激活。

03:06:36 UTC确认只有 `chrona.service` 仍running；所有本次backup、rehearsal、smoke、production、resume、recovery transient unit均不在running/activating/deactivating集合。服务PID2753388、NRestarts0；保护drop-in已移除，实际正常策略 `Restart=on-failure`、`TimeoutStopUSec=45s`、`SendSIGKILL=yes`。

02:58:43 UTC只读验收：health200、ready200、未鉴权/api/modules401、现有凭据鉴权/api/web/today200。实际exe、白名单data/DB/resource配置、live resources完整清单/字节/执行位对应clean caf46efa。旧Session51、Run63、AgentCommand63行保留；Mind main/settings页面由正常启动自然重新登记，caller版本与revision有效。QQ正式连接自然恢复并报告ready，未主动发QQ测试消息/通知；没有真实模型调用。没有真实浏览器尺寸/交互验收，也未证明用户实际业务全程可用。

### 正常七应用结果

三组固定原key均只提交一次，真实Author提交，normal build/typecheck/tests/continuity通过，durable CandidateReceipt均approved；没有pending review或schema转换。旧9commit/source历史保留；非目标Apps/MCP activeHash未变。完整receipt/materialDigest/版本id见evidence的actualProductionDeployment，原始P下material-production-*.json。

| 应用 | 实际active commit | dataSchema |
| --- | --- | --- |
| apps | `477b950e8aed71b78ed8480ed73e000d0b0a1e9c` | 1 |
| author | `07673002acf9247aa2a93e3dde48aecf06b78bb9` | 1 |
| chat | `f8f8fe9d4b9ad5aa3de32dedc734865c2af760de` | 1 |
| mcp | `0815de57954b58f199125c5196bd99d8dc4a6a69` | 1 |
| mind | `da0788a920cd2eda897a9751cc6314d3d4223f42` | 2 |
| notify | `d731484920eeed3e68d99dd4851d83bba8a9a5e7` | 2 |
| pi | `51e29501f757fd4285cf233b86d1350562f92fdc` | 1 |
| qq | `9e453467130082b62d306ca6c7f01c29f8af2258` | 2 |
| web | `34dd657af9abe5172479f734b487aaa814ac654b` | 2 |

### 本次最新停服备份与连续性

02:49:24 UTC确认原PID2576846/cgroup退出后，原DB完整guard通过，保存本次fresh baseline，再建立backup pair和附加根；备份后恢复到全新P/restore-check，SQLite quick_check、schema与旧业务/源码/content连续性通过，1003个附加根文件真实解包/hash通过。本次备份不被旧01:36演练替代。

| 文件（P/backup） | bytes | SHA256 |
| --- | ---: | --- |
| `before.db` | 394350592 | `c494c6c271ae6e66a772c7c38d48dd2706a3abf21784163811c5f791ca1eebf3` |
| `before.db.tar` | 166516224 | `f81a44b70aa24395e8ea04f43028ea5ef98640c0f211f19c5fb3b19743f78424` |
| `external-roots.tar` | 74598400 | `24c78f381be20fa79b65cdc80d6a56b392b7a357ccfa069f667877a3106acc50` |

离线真实生产连续性：132应用数据文件、4709旧content文件、440旧源码文件，9旧commits保留；18张核心表完整行相等（含51 Session、63 Run/AgentCommand、execution系列和migration）。其中4应用SQLite库是既有 `backupDataFiles` 在 `sqlite-backup-files.ts:95-103` 经 `VACUUM INTO` 生成备份的物理字节差异：notify.db/chat.sqlite/mind.sqlite/QQ conversations/sessions.sqlite。对该4库只读比较完整sqlite_master逻辑schema、user_version、全部用户表及sqlite_sequence的完整行多重集（含NULL、blob、重复行）、quick_check和foreign_key_check均一致；未改journal/schema_version、未VACUUM真实库。普通文件仍byteexact。临时fixture证明VACUUM等价通过、删重复行/改schema拒绝。restore副本9个generation marker依法单列，真实库marker字节保留。

### 两次验证器错误与固定unknown证据

r2原unit `chrona-cleanup-reorg-production-8ce927b2-r2.service` invocation14904d09657643c3bda531ec928795ff完成七应用后，02:52:08因误把VACUUM备份物理字节当原DB字节而失败；候选尚未start。父批准上述窄逻辑比较修法，原失败checkpoint保存在P/resume-once.json.previousCheckpoint，原actions保留。

只续剩余verify/switch/start的resume unit `chrona-cleanup-reorg-production-8ce927b2-r2-resume.service` invocation9f5ea32c9c314fb6891ea6ad3ad57a39，于02:55:17已成功启动新包且HTTP通过，但在线瞬时全guard误把正常running web.page-set视为失败，在02:55:21正常stop，造成新的本地页面登记unknown。这是验收时序错误；未自动回滚。随后区分停止边界full drained与在线正常inflight，临时fixture证明正常running不失败、实际unknown effect/无关unknown拒绝。

用户原唯一例外Invocation `146941c1-2da2-4864-83c4-4b7a8a3aa44d`全行SHA始终 `b040fb97f9fb039bdf13f643446f0b43b26dbe06c1b8e7bf343f525ef9d0dac8`，未改/删/重放/换key。

额外故障行 `840dfcfd-8ee9-46d5-b142-6ce7babc2810` 是Mind da0788a... → Web 34dd657... `page-set`，sync、idempotent、固定key `09b3caf7-78fa-45d9-aa26-7d37178ada70`，requestDigest `1935ad5ae1ff557ae0e9920bb6fe607a959a5ff57f091eed152f09bf98dfeba1`，全行SHA `643100947a47b12b059f3f4c487e5482980c5b7c015b0fbb3966d2f9270abac3`。它**不是只读工具**：仅原子替换Web私有pages-v2.json的页面登记，无外部消息/模型效果。父在核具体写合同后明确授权保留这一精确故障行，恢复现有unit；这独立于用户原历史例外，不扩展到其他unknown。原行状态/key/hash未变，没有重放；正常启动新独立页面登记自然收敛。旧页文件未手工改写。

recovery unit `chrona-cleanup-reorg-production-8ce927b2-r2-live-recovery.service` invocation0e8e31ffa3ff4e3a8a36a393bcf60666于02:58:43 exit0、HTTP/material/data观察通过，checkpoint `production-deployment-accepted`；这个checkpoint只代表当时检查范围，**不代表最终功能验收通过**。其前一failure保存在P/recover-live-once.json.previous，全部actions原样保留。

停机动作窗口：02:49:24.611请求stop至02:55:17.529 start完成约5分52.918秒；误停02:55:21.913至02:58:34.179 start完成约3分12.266秒；合计约9分05.184秒。首次候选start到再次stop中间约4.385秒运行；正式最终进程02:58:34启动，HTTP确认02:58:43。上述是stop/start动作时间界限，不能冒称逐请求测量的可用性SLA。此前01:36备份窗口约37秒单列。

### 未完成的产品问题与父已选方向

Pi active `51e29501f757fd4285cf233b86d1350562f92fdc`与发行 `8bf7c40377abdd82d7bbfd067a92c5fb4dc5bad1`源码tree同为 `74a742c480e543129d7edea45c0314eed8254ae9`，但正常Author新commit不是发行commit。module-supervisor.ts:183-200和module-release.ts:67要求精确发行commit，正确拒绝host配置；Pi默认agentUrl空字符串才触发loopback错误，不能放宽URL/auth或伪造env修复。私有clone真实bundle证明两commit相互不是ancestor；普通update merge会生成第三commit仍无法授信。install模式拒绝已存在module；Author/公开submit输入不能携sourceCommit。隔离首次安装smoke健康不能证明这种已安装升级路径健康。

父决定由后续唯一writer实现显式exact-release更新选择，优先现有owner CLI：只选真实发行lock/bundle固定commit，要求实际已批准active版本和source tree与发行全等，正常candidate/build/test/approval/activation，旧Git/history保留；普通update合并语义不变，providerHost精确commit校验不变，不开放内部sourceCommit给普通app自授。需分叉同tree成功/不同tree与身份变化拒绝/恶意参数等测试、独立review、完整新clean发行后再部署。本writer没有修改产品源码、合同index、发行或真实DB状态。

保留Apps477b950...在activated调用退役web.component-set导致应用中心登记失败。旧源码已完整复制到D/apps-current-source（省略node_modules），无upstream配置，原Git和定制未改。父批准后续普通应用最小迁移方案：index.ts直接以已有dist/ui.js默认mount、ui.css、props view和原tools调用当前page-set；module.json删component-set uses；业务core/service/materials不变。须private副本完整原tests/typecheck/build+activation fixture、真实Author正常审批后部署；本轮未改Apps真实/副本源码。

任何后续重新停服必须重装保护drop-in、reload、实核infinity/noKill/noRestart后才stop；在线不能要求瞬时全库零active，不重放原keys，不恢复旧DB或无条件旧包。两保留unknown必须逐行全hash固定；其余未知外部效果继续阻断。当前fresh备份是停服前旧app状态；新服务已运行并自然写入最新状态，不能直接用旧备份/旧包回滚。尚未运行任何新的产品构建或源码修复。
