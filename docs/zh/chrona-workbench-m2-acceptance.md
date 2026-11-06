# M2 服务器编码与 Neovim 验收记录

状态：**协调者于 2026-11-05 通过 M2 开发集成验收**，保留下列明确环境限制和 Workbench 已有失败。本记录不是公开发行、部署或真实模型/设备验收。本记录保留 M2 当时的边界；后续 `P2-20261106` 与 M3 已于 2026-11-06 另行通过[开发集成验收](chrona-workbench-m3-acceptance.md)，不追改本记录的历史测试结果。方案见[统一开发计划](chrona-workbench-unified-development-plan.md)，使用与限制见[服务器编码工作](server-coding.md)。

## 已审阅集成范围

- F：Run 队列上的编码准入、严格 moduleId/hash 身份、独立项目上下文和日志、真实 Provider 退出证据、预算与生命周期守卫。
- G：同事务停止事实、保留快照与详情、字节配额、生命周期游标、真实问题的有效性判断。unknown 保留目录，历史快照不能恢复批准权限。
- H：官方 coding/editor 外置应用、13 个固定 editor 操作、同一不可变成果与 owner 接受路径、固定 sidecar 的有界代码变更捕获及既有 content 发布。
- N：Workbench 可选 Chrona backend、主动 attach/recover、detach 与 cancel 分开、跨入口答复、经既有 owner MCP 读取成果并核验 SHA/身份/基线、只读 diff/文件展示。Pi 直连保持独立。
- 协调者：共享契约与单一开发迁移、host 认证和项目映射、Provider/运行时装配、完成回调走既有 routed outbox、健康应用的业务拒绝不触发进程重启。

## 已完成的有界证据

| 场景 | 实际环境 | 结果 |
| --- | --- | --- |
| F 执行与适配器目标检查 | 真实 SQLite/Run，局部 fake Provider；独立类型与 lint | 96 测试通过，1 个实际 bwrap 环境跳过；types 通过 |
| G host 集成 | 真实 Hono、runtime、SDK 子进程、SQLite，只有 Provider 是 fake | 4 测试 / 117 断言通过；store 19 / 98；shared 2 / 6；types 通过 |
| 后台继续、答复、重新打开、显式取消 | 独立真实 host、实际 fake Pi JSONL 子进程、原 Workbench headless Neovim Lua 客户端 | 原两场景 2 测试 / 208 断言通过 |
| host 强制结束后恢复 | 新 host PID、同一临时数据库和尝试、实际 lease 过期 | unknown 保留目录；Pi 启动计数没有增加，未自动重跑 |
| 代码成果捕获 | 真实临时 Git 仓库：staged/unstaged/delete、untracked/ignored、编码/二进制/符号链接/gitlink、预算和污染 GIT 环境 | 6 测试 / 34 断言通过；作者检查、生成物、独立声明消费者、模块 typecheck、严格 lint 通过 |
| Neovim 不可变成果读取与展示 | 客户端/协议/backend/视图目标用例，隔离 Xvfb+xterm 真实 Neovim 键盘 | 29 用例通过；style、109 文档链接、smoke、78 文件 LuaLS、headless、GUI 通过 |

Neovim GUI 使用合成成果检验 partial diff、文件快照、snapshot_unresolvable、旧成果缺少证据等展示；不把它当成真实 host 的 MCP 读取证据。随后成果增量首跑通过 2 测试 / 226 断言：最终原客户端经真实 `/api/mcp` 初始化、content.read、验真并显示实际只读 diff；Prisma 查询观察在清空 heldDirectory 前读到 sidecar；目录释放后改写项目，MCP 重读仍返回原不可变成果。目标 eslint 和仓库 tsc 通过，两个专用终端已关闭且无 fixture 进程遗留。报告 `N-host-delivery/artifact-report.md`。临时 Git helper 检查本身不单独证明 tick 的捕获顺序。

## 最终集成待办

- [x] 真实 host 执行完成后，在释放目录前生成 sidecar；实际 `answer.txt` 变化进入不可变成果。
- [x] 最终 Workbench 客户端经真实 host `/api/mcp` 读取并核验同一成果，显示实际 diff；保留原 detach/reopen/restart 场景。
- [x] 原 Chrona 集成树串行 typecheck、lint ratchet、boundary、Bun/API 回归与合同打包检查：Bun 1220 通过 / 7 环境跳过 / 5954 断言，API 49 通过 / 2 环境跳过 / 590 断言，0 失败。发行检查单独待下项。
- [x] Linux x64 发行 build 与实际启动 smoke：正常发行环境 build 与 fresh SQLite 启动、Web 页面、认证 today API、包内模块类型检查均通过。首次继承 NODE_ENV=test 的构建失败日志保留；重构发行后通过，未修改 DB 安全保护。
- [x] 原 Workbench 完整 75 spec 回归：792 通过 / 1 已有失败 / 0 错误；`buffer_sessions:689` 原 HEAD 可复现 expected 1032 / actual 1007。全局 style、LuaLS、smoke、109 文档链接通过；保留失败断言。
- [x] 汇总首次失败、环境限制、终端退出与关闭、精确源码哈希；M2 以这里的开发范围通过，P2 可开始冻结。

## 首次失败与修复

原整树检查先暴露复杂度债务与依赖环：拆分原函数职责，执行状态/安装类型/删除 payload/coding storage 下沉到直接依赖的叶子；CLI 与 server 复用 integrations 模块资源装配，CLI 不反向导入 app；合同 ModuleTool 下沉到 schema 叶子。未调低 ratchet 或绕过 boundary。最终仅既有 doctor 复杂度警告与 8 条显式测试深导入警告，无生产依赖环或 boundary 错误。

首轮回归误用旧 dev shell 的 Bun 1.3.13，引发原 1 GiB 模块限制下 Web/线程 fixture MemoryExhaustion；此前目标检查的实际 binary 与 fixture shebang 证实用 Bun 1.4.2，项目要求也为 >=1.4.2。显式 PATH 指向已有 1.4.2 后在同一内存限额下通过全组，没有放宽 sandbox。其他初次失败由官方目录由 4 增为 6、owner 工具列表新增 executions、build fixture 未等待真实 finalizer 导致；更新精确名单并使用既有 tick.settled({includeRuns:true})，所有权限与通知断言保留。详细旧版本失败与修正后的完整日志分别为 `M2-shared-seams/regression` 与 `final-checks-r4`。

## 验收结论与交接

当前原始集成源码的 private-index 交付树为 `ba7ce17b165c69d46a761703ad742c259036ada6`，完整补丁 SHA-256 `5d23ec73a63a4e8dc14ecb820dc7697b600461f2e27de5193f2a341c63cce70c`；这是更新本验收结论前的代码/文档快照，后续最终文档交付另行记录。Linux x64 归档 SHA-256 `68360e5ad9d4257dec66fcff2466f977f96b19a2beea6f9b67cc2407abdeb121`。完整原始结果见 `M2-final/manifest.json`、`M2-shared-seams/final-checks-r4`、`final-workbench` 和 `release-r3`。

协调者各轮检查终端均读到实际结果后关闭；最终 terminal list 仅保留原有非任务终端 `term_9af17538-992f-4a38-9316-6c4fcefc34ab`，未关闭用户终端。上文 Workbench 已有失败和环境 skips 不等于新增结果读取失败；M3 验收仍须重新证明设备、独立 worktree 与并发，不继承 M2 结论。

## 证据与边界

会话证据根目录 `/tmp/chrona-unified-20261105-c2mdd7yu`。已交付报告为 `F-delivery/report.md`、`G-delivery/integration/report.md`、`N-host-delivery/report.md`、`H-delivery/diff-increment/final-report.md` 和 `N-result-view/report.md`；各自 manifest、首次失败日志、退出码及终端关闭回执保留在同目录。临时路径是本次本机证据，不是发行资源或持久安装依赖。

原仓库 HEAD 保持 Chrona `8294408fb260f14607b9b3d8199f2b1a8d4e54f8`、Workbench `3f633c9ce4855958fc5eed51d465cee4447b1584`，交付保存在用户原有未提交改动之上。没有 commit、push、stash、部署、个人设备配对或真实数据迁移。所有实现/验证使用获准开发树与临时数据库、项目、凭据和 fake Pi；不声称真实模型完成质量、生产反代或跨设备执行能力。

代码变化是明确 baseline 到结束时工作区的比较，包含已存在的 dirty 内容；缺口不等于无变化。人类接受仅记录对结果版本的接受，不自动应用、提交或合并。
