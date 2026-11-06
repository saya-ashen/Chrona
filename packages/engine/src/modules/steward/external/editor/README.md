# editor

官方可选单 owner 编辑器入口。唯一 server 为 `chrona.serve(handler,{idleTimeout:30})`；manifest `listen:"/api/editor"`、`uses:["*"]` 沿现有 admitted owner 语义调用。认证由 host `/api/editor/*` API_KEY gate 完成一次，模块不读取 key、不创建 token、不从 body/header 推断 owner。

冻结 v1 路径：

- `POST /api/editor/v1/commands`：严格 `{v,requestId,command}`；Content-Type 必须为 JSON。
- `GET /api/editor/v1/events`：严格单值查询，拒绝重复/未知键，复用 `editorEventsQuerySchema`。

响应复用 `EXECUTION_PROTOCOL` 与 `EXECUTION_HTTP_STATUS`。合法 requestId 回显；损坏 ID 为 `invalid`，未知版本为 unsupported_version。已知 routed code 原样映射；普通异常/unknown 变为 unavailable，不泄漏异常文本，不解码 message 前缀。

`protocol.ts` 的 `editorCommands` 满足完整 `EditorCommandConsumer`，`handleEditorCommand` 给逐 op 返回类型。start/create 与工作/成果操作走 coding 八工具；lookup-start 直接 executions。attach/get/lookup 保留实际 sessionId，events/snapshot 先 coding.get 核对 run/attempt，再使用实际 sessionId。detach 只返回 accepted，不发 cancel。

`poll.ts` 仅持 HTTP 等待槽：单 owner 至多四条、总上限 15s、空页间隔至多 250ms，每次 executions.events 都 `waitMs:0`。HTTP abort 立刻释放槽并停止后续读取；当前即时 SDK RPC 没有跨进程 AbortSignal，但不会留下 G 的 15s waiter，也不会取消业务执行。成功、异常、abort 都由 finally 归还槽。第五条返回 capacity/429 与 Retry-After。

共享资源 `contract.js/.d.ts`、真实 SDK typed event errorCode、host auth/listener/module 安装登记由协调者接线；包内不复制 schema、不导入仓库运行时裸包。`test.ts` 覆盖公共 schema、精确路由、实际 SDK Unix HTTP 端点、实际 sessionId、冲突/错误 envelope、循环四槽/第五条拒绝、abort 释放与 detach 不 cancel。上游反代超时与真实部署不在作者检查范围。

v2 显式使用 `chrona.execution.v2`，全部十三op（含events）POST同 `/api/editor/v1/commands`。完整WorkRequest经 `coding.work`，不复制业务图或Run队列；原v1请求/响应及GET事件保留。v2请求和完整成功信封分别最多256KiB，响应按原op/requestId及执行身份校验，未知版本不自动降级。events复用原四HTTP槽/abort/15秒上限，每次内核读取waitMs=0；snapshot后由客户端get恢复WorkView。父attach只返回工作概览，无伪造执行聊天。设备cleanup仍为独立owner MCP工具，不增加第十四个editor op。
