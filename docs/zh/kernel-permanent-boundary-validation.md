# 内核永久边界收缩验收记录

> 2026-11-09 当前状态：本文涉及旧 Editor 应用的架构、安装、接口、源码保留和验收结果均属于当时记录，相关运行指引已过时。Editor 已退役并移除；仅 Mind、Remind 整应用暂停并保留源码。现行编码接入见[客户端协议](coding-peer-clients-protocol.md)和[实施记录](coding-peer-clients-implementation.md)，删除范围及待补验证见[Editor 退役记录](editor-retirement.md)。保留本文的其他架构与历史证据；原测试计数、产物散列及部署事实不改写，也不证明本次清理已验证或部署。

日期：2026-11-09。本轮基线为 `cf19ceb704800e5c53e0784aff4558883f6afa9b`，验收对象是基线加当前未提交工作区；没有 commit、push 或部署。代码收缩和本轮范围内的工程验收已完成；公开边界仍作为冻结候选管理，未宣布永久只增不删。

## 范围与结果

- 内核公开注册为 `approvals/modules/settings/secrets/activity` 五个命名空间，共 32 个工具。其中 modules 从 31 个减至 13 个，approvals 从 6 个减至 4 个；三种实际审批 action 为 `activate_module/delete_data/modify_external`。Agent 工具是独立应用合同，私有 callback/host 不出现在公共目录。
- Agent 是唯一不可变内置应用；Web、Notify、QQ、Author 是普通默认预装应用。只展示内核、应用两类。Manifest 与 SDK 的旧设置、日历、健康自报、贡献聚合及便捷代理入口已收窄；不存在旧 API 兼容别名。
- 固定材料准入、单次消费、目标基线、原子集合、持久化 receipt、审批恢复与停止证据保留。独立复核发现的“已批准但执行未停导致候选搁置”已修复，恢复时重新验证完整绑定、授权、基线和停止证据；确认停止时清除旧错误。
- 普通异步调用缺失的 Notify 与其他应用一样在入队前失败；内核内部受限的延迟解析不下放给应用。Notify 自己决定通知策略，内核只保留有限事实、消费权、ACK 和撤回事实。
- Mind、MCP、Coding、Editor、Remind 暂停安装和运行接入，保留源码、依赖材料和离线种子；memory-local 保留记忆工具，暂停定时整理。没有删除这些应用，也没有引入通用新定时框架。

## 联合检查

重型命令串行使用 `/tmp/chrona-permanent-check.lock`，内存上限 8 GiB、swap 上限 1 GiB，Node heap 上限 6144 MiB。测试使用逐文件临时数据库与独立数据目录，不操作既有用户数据。

| 检查 | 命令或入口 | 最终结果与证据 |
| --- | --- | --- |
| 类型、lint、架构 | `bun scripts/chrona.ts check all` | 通过。类型无错误；lint ratchet 无新增债务，保留 doctor 的既有复杂度警告；依赖规则无降级，架构 0 错误、28 条测试导入警告。`/tmp/chrona-permanent-check-final7.log` |
| 全量 Bun | `CHRONA_TEST_CONCURRENCY=1 bun scripts/run-bun-tests.ts` | 本次启动发现的全部 185 文件：2011 pass、7 skip、0 fail，无重试。`/tmp/chrona-permanent-full-bun4.log`。暂停应用专属套件不属于活动范围，暂停边界测试仍参与验收 |
| 离线管理命令 | 显式临时 test.db 下运行 `bun test --timeout 20000 ./packages/cli/src/admin.bun.test.ts` | 21 pass、0 fail，另行 scoped lint 与最终类型检查通过。批准删除、备份与停止锁保留，Author/Files/Events 离线恢复及五暂停应用拒绝安装已检查；不属于 185 文件全量计数。`/tmp/chrona-permanent-admin-final.log` |
| 新增底层合同回归 | `module-tool-contract.bun.test.ts` | 全量发现之后增加的 2 项测试单独通过，固定 canonical hash 及对象/数组顺序语义；不是重新运行全量所得的计数。见 `/tmp/chrona-cycle-hash-tests.log` |
| 重构定向验证 | owner、caller、Agent、候选、集合、审批恢复、facts、输出影响等 13 文件 | 200 pass、0 fail，显式临时数据库。`/tmp/chrona-cycle-tests.log` |
| API | `bun scripts/run-api-tests.ts` | 最终核心重构后 21 文件：115 pass、2 skip、0 fail，无新增 runner 过滤。`/tmp/chrona-permanent-release-verified.log` |
| 浏览器 | `.tmp/kernel-permanent-boundary/browser/run.sh` | 最终审批收缩后 77 pass、0 fail；桌面、平板、手机 32 张截图，无横向溢出、浏览器错误或外部请求。`.tmp/kernel-permanent-boundary/browser/run-1794158052/results.json` 与 `acceptance-report.md` |
| 资源与二进制 | `bun scripts/build-binaries.ts --target linux-x64` | 离线精确种子验证、资源组装、可执行文件与归档构建通过。最终核心代码重建后证据：`/tmp/chrona-permanent-release-verified.log`，末尾 `FINAL_RELEASE_VERIFY_EXIT=0` |
| 新数据目录启动 | `.tmp/kernel-permanent-boundary/offline-smoke.ts` | 使用最终二进制、全新临时数据、Provider none；Bun 安装强制 `--offline`。真实生产服务器健康、入口及 Web Today 烟测通过；清理临时进程与目录。包含于同一最终发布日志 |
| 独立代码复核 | 当前授权、审批、Notify、候选恢复、Run 停止等路径 | 最终复核未发现具体高、中风险缺陷。`/tmp/acp-delegate/del_mw83ilo7_ritc.out`。这是静态复核，不代替测试 |

Bun 的 7 项跳过属于环境探测与隔离条件；其中 sandbox 5 项明确由于 bubblewrap/namespace 不可用，另有可选主机程序/隔离变体。API 两项为 bubblewrap 变体和未启用 `CHRONA_U_REAL_GUI` 的真实 Neovim GUI；通用执行与假 Pi 的真实 SDK/RPC 验证正常执行。没有修改外部 Neovim 客户端，也不声称通过其真实端到端验收。

## 最终发布布局

产物：`dist/releases/chrona-linux-x64/chrona`、`dist/releases/chrona-linux-x64.tar.gz`。

- `builtin`：`agent`。
- `external`：`author/events/files/memory-local/notify/qq/web`。
- 离线源码种子 13 份：`agent/author/coding/editor/events/files/mcp/memory-local/mind/notify/qq/remind/web`。暂停应用在校验来源后从运行资源中排除，保留 bundle、lock 和源码来源；本地 `resources/module-git/repos/` 可由版本化 bundle 重建，不作为新增源码提交。
- 实际目录核对：`.tmp/kernel-permanent-boundary/release-layout.json`。构建使用当前源码的 Agent/Web 产物及共享 entry-app 生成文件，没有通过恢复旧 Manifest 字段重建暂停应用。

## 当前限制与冻结状态

1. Author 目前提供八个材料工具及固定提交、查询回执的工作流；自动模型编写执行仍为 `supported:false`，没有把普通 Agent.run 冒充带精确模型/时间/提交限制的作者执行。
2. 隔离 model completion 的原生输出 token 上限仅验证 Pi 1.5.0 的受支持请求构造。Codex `openai-codex-responses` 等无法证明输出硬上限的 completion 路径会拒绝执行。普通前台 Pi RPC 不受此限制；没有真实模型验收。
3. 暂停应用的恢复、取舍或源码删除留待后续决定；本轮不自动恢复，也不推导删除权限。没有迁移真实数据、触及既有 3111/3112 服务、发送外部消息、部署或 push。
4. G1–G7 工程出口已完成本轮范围验收。G8 是公开合同的永久承诺，与代码实现和自动测试不同：当前合同已逐项列明输入输出、权限与 pinning，但仍明确标记冻结候选，未宣称 API 从此永远不改。

临时日志与浏览器证据位于本机；本文件保留命令、结果、范围及限制，避免把临时文件的长期存在当作承诺。

最终产物 SHA-256：

```text
ffec26d404ce8102b7381cd91818243a99ccd7ec7a02b3bec16c40ccf6ad00fc  chrona
201a7dbb17248198c2e2ccc6f4ab394c89829a9c953d485a4524226e97aba446  chrona-linux-x64.tar.gz
```
