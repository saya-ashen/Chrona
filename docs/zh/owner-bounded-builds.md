# Owner 单次受控构建

状态：实现与离线验证中；尚未部署。

## 入口

MCP 工具 `chrona_build` 转发到 `modules.build-owner`。仅 owner 和入口 `mcp`/`web` 可调用；普通模块和 Provider 不能借此指定任意模型。原 Provider 的 `modules.build` 不变。

```json
{
  "name": "web",
  "goal": "仅修改已授权的内存上限，保留全部现有功能",
  "intent": { "changes": ["内存上限"], "preserves": ["所有页面和数据"] },
  "requestKey": "一次明确授权的唯一标识",
  "execution": {
    "provider": "pi",
    "model": "openai/gpt-6.1-sol",
    "timeoutMinutes": 10,
    "maxSubmissions": 1
  }
}
```

- 只允许一个模块，不接受宿主文件路径。
- 同一工作区的 `requestKey` 是单次授权：相同请求重放返回原运行，即使它已失败或超时；不同内容复用该 key 被拒绝。不自动重试、续跑或更换模型。已有 stop-build 可停止；revise-build 不能续跑这种运行。
- 时限和提交上限在入队时检查不超过全局上限，作为内核审计记录保存；claim 时写入真实 deadline 与提交预算，不读取候选可修改的 request.json，不改变工作区全局设置。
- 仍使用现有每日预算、FIFO、单构建并发、沙箱、类型检查、作者测试、连续性检查及版本哈希绑定的审批。构建完成不等于启用。
- Pi 必须支持逐次指定模型，发出 prompt 前核对实际 provider/model。不匹配直接失败。受控运行使用临时私有 Pi profile（凭据由 Pi 引用原 profile 管理），关闭自动重试与自动压缩；退出后清理临时 profile，不改服务 profile 的设置。

## 本地恢复

当线上入口本身无法升级时，可在**服务停止、数据库已备份、没有 queued/running 工作或 building/testing 候选**的条件下运行：

```sh
chrona admin build /path/to/authorized-request.json
```

使用与服务相同的 `CHRONA_DATA_DIR`、Provider、SDK、沙箱和资源配置。命令取得独占数据库锁，只启动该次构建与 loopback 的 run-capability 工具桥，不启动普通 tick、网页/QQ 常驻模块、内置模块升级、提醒、反思或其他作业。已有未完成工作时拒绝执行；失败不会自动继续。

候选通过后，使用原有审批入口或 `chrona admin approve <approvalId>`，只在用户明确批准该版本后执行。恢复命令本身从不自动批准或激活候选。随后恢复线上服务或按部署流程切换，核对健康状态和版本。

## 验证

- 假 Provider 与真实测试沙箱：单次运行、预算绑定、重复 key、异常重放、拒绝续跑、实际检查和不自动激活。
- 假 Pi 子进程：精确模型参数、prompt 前模型核对、重试关闭、临时 profile 清理及原设置不变。
- MCP 作者测试：公开工具与参数转发。
- 不在自动测试中调用真实模型、QQ 或生产库。
