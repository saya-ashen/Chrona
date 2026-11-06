# 服务器编码工作：开发集成说明

当前 M2/M3 开发集成已通过，尚未公开发布或部署。真实 Hono/SDK/SQLite、fakePi、Neovim、固定本机 executor、有界并行、不可变成果比较/接受与独立 worktree 清理的实际证据见 [M3 验收记录](chrona-workbench-m3-acceptance.md)和[统一方案](chrona-workbench-unified-development-plan.md)。本页保留旧 server 项目配置示例；v2 固定位置授权、预算和设备协议见 [P2 契约](chrona-workbench-p2-contract.md)。真实模型效果、个人设备安装和其他平台原生执行仍未验证。

## 安装与受信项目

`coding`、`editor` 是可选官方外置应用，使用既有 `modules.install` 或停止服务后的 `chrona admin install`，仍经过相同的作者检查、类型检查和启用流程。不是默认预装，不修改内置应用来伪装入口。准确安装参数与配置流程沿用[运维说明](operations.md)。

owner 在私有数据目录放置 `execution-projects.json`；项目映射按真实 workspace、owner 和 coding 模块 ID 授权，不能仅凭模块名授权。示例中的值全部需要替换为本实例实际值：

```json
{
  "projects": [{
    "workspaceId": "your-workspace-id",
    "ownerId": "owner",
    "moduleId": "your-coding-module-id",
    "projectRef": "my-project",
    "canonicalPath": "/absolute/canonical/project",
    "baseline": "commit:<full-commit-digest>"
  }]
}
```

映射在运行时首次解析后缓存，修改后重启实例。目录必须为服务器实际规范绝对路径、可读写且不经路径别名；客户端不能直接提交任意 cwd。`snapshot:<opaque-digest>` 可以记录明确快照引用，但没有对应可还原文件时，不能生成相对该快照的代码 diff。完整 commit 基线的成果比较覆盖该基线到最终工作区，包括此前已有未提交内容，不声明所有变化都由 Agent 独占创作。不要为准备基线自动 reset、clean、stash 或提交用户文件。

## 客户端和权限

editor 的 `/api/editor/*` 使用现有 owner Bearer 身份。API_KEY 未配置或空白返回 503，配置后无效身份返回 401；不要将 key 放进 URL、页面、运行日志或工作内容。Workbench 通过自己的凭据 supplier 在内存中获取身份，具体配置见其 `doc/chrona.md`。连接反代的时限需覆盖 15 秒事件读取和客户端超时；本轮仅验证实际本地 host 代理，外部生产反代需独立验证。

`coding.create/get/list/send/answer/cancel/results` 可由 owner 入口或获准 Provider 调用；`coding.accept` 仅 owner。官方 editor/web/mcp 等经过批准的 `uses:["*"]` 入口按已有路由规则使用 owner 工具，仍保留真实调用身份。coding 对 executions 的后续调用绑定 coding 自身不可变 moduleId/hash。旧 hash 不能读取或控制新身份；owner 可核对其获准工作。

## 执行、问题与恢复

工作在原有 Session/Run 队列中运行；v1 保留原单服务端语义，v2 编码并行预算为全库 4、每 executor 2、每应用 2。同一可写目录在排队、运行和停止待确认期间独占。编码 prompt 只包含项目规则、目标、明确基线、预算和截止时间，不复制个人偏好、日程和记忆。实际日志在独立 session 目录。

退出 Neovim 只 detach；显式 cancel 才请求停止。取消先持久记录意图并撤销运行能力，实际 Provider 退出才能确认停止。启动门结束、HTTP 超时、租约过期或服务器重启都不证明写入进程已停；未知工作保留目录，不自动重跑。服务恢复后按租约事实进入未知状态，需核对执行现场；当前不提供把未知状态直接改成成功或强行释放目录的产品操作。

问题用实际持久 requestId 回答，`false` 和选项 `0` 都是有效值。活跃快照只有在同一真实 ProviderChannel 仍等待时显示 pending；历史或新进程不能恢复旧批准权限。跨入口重复答复只生效一次。正常输入或目录冲突拒绝结束该调用，健康的应用进程继续服务。

仍占用执行目录的应用不能停用、切换代码、开始迁移或删除；先取消并确认现场。editor 本身的视图断开不改变 coding 的归属。未知结果和活动关联仍阻止删除。

## 成果与审阅

完成回调通过原有 routed outbox 调用 `coding.get` 核对并发布成果，不创建第二队列。不可变 JSON 成果同时保存于 coding 私有 canonical artifact 与既有 content 目录，artifactRef 包含全部字节的 SHA-256。通过现有 owner MCP 的 `chrona_module_call` 调用 `content.read`，引用为 `coding/<artifactRef>.json`；当前 Web 图片内容端点不作为 JSON 下载接口。

成果包含工作、会话、运行和尝试身份、明确基线、保留的最终助手文本及真实检查记录。没有可信命令证据时 `checks:[]`，完成不表示测试通过。变更捕获在实际 Provider 退出后、释放目录之前完成，受文件数、字节和时间上限约束；二进制、符号链接、无法解析的快照和超限内容明确标为缺口。缺少变更证据不等于没有代码变更。已发布版本不会在重新读取时扫描项目或改写。

人工接受仅记录对该结果版本的接受，不 apply、commit、merge、push 或部署。工作树和未提交文件保留在执行设备；清理由显式且独立的操作授权决定。M3 提供独立 preview/confirm：confirm 绑定原 previewDigest 和稳定 commandKey，重查实际占用、dirty、未集成提交与显式保护；结果不确定时不得换 key 自动重删。依赖只消费精确直接前置的公开不可变成果上下文，不会自动应用或合并前置变更。
