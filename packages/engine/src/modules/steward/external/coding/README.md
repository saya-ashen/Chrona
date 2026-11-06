# coding

官方可选服务器编码应用。唯一执行入口是 SDK routed `executions.*`；不启动 Provider、队列、worktree、设备或自动重试。项目只接收 `projectRef`，由 host 按真实 coding moduleId 授权映射。

八个公开工具固定为 `create/get/list/send/answer/cancel/results/accept`；前七个可见性 `owner/provider`，人工接受 `accept` 仅 `owner`。每个工具接收 `{input:string}`，文本为冻结公共 schema 的 JSON payload，不含 `op`。实际工具入口仅调用一次 `parseCodingToolInput`。Web、QQ、MCP 和 editor 共享同一工具；内核已获 owner admission 的 `uses:*` 入口仍保留真实 module caller，coding 不按名字提升权限。

`activated` 登记现有 json-render 工作列表。`get/results/accept` 都调用同一 `reconcileCodingResult`：读取既有 execution，确认终态与实际停止后，从保留 snapshot 和内部只读 `executions.result-source` 获取成果文本及可信 baseline。没有最终消息不发布成果，没有可信检查证据时 `checks:[]`，不从 completed 推断测试通过。内部 result-source 的可选 `changes` 嵌入同一 immutable artifact：scope 固定 `baseline_to_worktree`，包含入场已有改动，不宣称仅由 Agent 创作；partial/unavailable/缺字段均不可解释为无变更。snapshot baseline 不能还原时明确 unavailable。成果与接受分开；`accept` 仅持久化人工回执，不应用 patch、不 commit/merge/push/deploy。

模块私有数据：

- `<data>/<workId>.json`：原始 start commandKey/body、实际 execution refs、结果版本及 acceptance receipts。原始意图先原子写入；未知 start 回执先 lookup 原 key，只有明确 not_found 后显式重复 create 才重交原 body。
- `<data>/artifacts/coding-result-<sha256>.json`：有界、不可覆盖的 snapshot 最终消息（含源 artifactRef/缺失标记）、baseline 与 checks。结果 resultId 由同一 digest 稳定生成；重启与重复 reconcile 不重复发布，接受不修改 artifact。
成果整体 JSON 限额192KiB；超限时去掉 changes.patch 和 untracked 文本并标 partial/limit/size；必要时清空 finalMessage.text 并标 truncated/missing，仍超限则拒绝发布。保留已有 SHA 版本，不补写旧结果；checks 不会因存在 diff 变为 passed。

- `<content>/coding-result-<sha256>.json`：与私有 canonical 字节相同的已发布成果。临时文件完成后用同目录原子 link 发布，既有版本拒绝覆盖。`artifactRef` 为 `coding-result-<sha256>`，既有 `content.read({ref:"coding/"+artifactRef+".json"})` 沿真实 module content 根读取；不读取 host 项目路径。发布缺失时 reconcile 从私有 canonical 恢复，内容不匹配返回 conflict，不覆盖。

共享接线要求由协调者完成：

1. `bun build/execution-contracts.ts <external-root>` 生成 `contract.js` 与八工具 manifest；类型声明也由协调者生成。包内仅导入 `./contract.js`，不依赖仓库运行时路径。
2. 内部 `executions.result-source({workId,runId,attemptId})` 返回 `ExecutionRef & {baseline:{kind:"commit"|"snapshot",digest:string}}`，沿真实权限读取 admitted 不可变事实。
3. SDK 保留已知 typed errorCode，旧普通异常仍为 failed；不解析异常 message。
4. F finish 已提交后如需即时发布，受信 owner 入口调用既有 `coding.get`。读路径与重启核对走同一 reconcile，coding 不自建轮询器/完成队列；本包不声明未接入的自动完成回调已工作。
5. 活动 execution 的 module 停用/删除 guard 与占用释放属于 F/runtime 装配。模块不能用私有状态冒充进程停止。
6. 成果读取复用现有 `content.read`，无需新 reader 或第九工具。现有 Web page-content HTTP 只允许 raster 图片，不能用该路径提供 JSON 下载；本页明确给出 content.read 引用规则，未宣称存在 JSON 下载按钮。

`test.ts` 用临时私有目录及真实 SDK author harness 的 routed stubs 验证：边界解析、原 key 恢复、不重复 start、重启 reconcile、不可变成果、显式接受、caller admission 与页面登记。没有使用真实项目、数据库、模型或账号。

## 多位置工作（M3 作者实现；集成与设备清理待验收）

v1 八工具及 schema 保留。新增 `work({input:JSON.stringify(WorkRequest)})` 消费显式 `chrona.execution.v2` 的十三 op；Web、QQ、owner MCP、editor 使用同一业务入口。`workspace-cleanup` 单独 owner 可见，`reconcile({input:JSON.stringify({workId})})` 只对模块开放且核查真实 module caller。接受结果不能清理或合并。

`works-v2.json` 原子持久冻结图、原 start body/key、精确执行引用、派发意图、已消费的 immutable 成果引用、父/叶取消栅栏。父最多20子，无Run；未满足依赖的叶不申请Run。前置必须实际completed且stopConfirmed，存在已核验SHA成果，才保存精确resultRef并申请一次执行。失败/未知/缺成果阻派；依赖只传成果引用，代码不会自动进入下游。原回执丢失先lookup原key，不改位置/基线/预算；取消在派发前持久封禁。未知start回执尚未定位执行时保持unknown，不能报告安全取消。

激活时幂等登记固定key `coding-dependencies` 的每5分钟schedule并核对一次；schedule只推进业务条件，Run仍是唯一队列。`reconcile`复用相同逻辑供可信完成通知使用，即时outbox接线归协调者，不能把五分钟兜底说成即时联动。模块暂停和schedule开关仍由现生命周期管理。

位置目录、固定workspaceRef、ready状态及claim sourceReceipt来自受信 `executions.locations/start-v2/placement`，模块不读取host配置或设备路径。独立worktree由可信host adapter在明确commit创建，默认保留；缺端口直接失败，不伪造ready/removed。`executions.workspace-cleanup`负责稳定confirm回执和stop/hold/dirty/unmerged/人工保留重查；preview不释放保留，confirm仅授权精确预览绑定且无人工保护的树。当前设备cleanup无冻结传输，必须unavailable并保留现场。

父results返回各自child四身份/独立baseline/原SHA版本，不拼合patch。比较由客户端分别读取两份既有immutable artifact并核对SHA与身份；partial/unavailable不等于无改动。snapshot后重新get工作投影，不能用旧历史快照覆盖workspace/source事实。工作列表按UTF-8字节缩页并返回after；results超完整信封预算明确失败。

`test-v2.ts` 使用临时私有目录与最小受控端口替身覆盖冻结图、循环/跨父拒绝、原key恢复、停止与缺成果阻派、后台核对、精确child成果和父取消。实际运行结果见作者delivery，不以测试源码存在代替通过。
