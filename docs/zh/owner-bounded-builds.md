# Owner 单次受控构建

当前实现参考；不据此推断线上部署状态。M1 限定所有 owner/admin 构建目标为外置应用，内置 web/mcp/files/notify/events 的修复须更新 Chrona 发行。开发检查、协调者已签署的 M1 验收与环境边界见 [M1 验收记录](chrona-workbench-m1-acceptance.md)。总览见[当前架构](architecture.md)，检查后的启用规则见[安全机制简化](security-simplification.md)。

## 入口

MCP 工具 `chrona_build` 转发到 `modules.build-owner`。仅 owner 和入口 `mcp`/`web` 可调用；普通模块和 Provider 不能借此指定任意模型。原 Provider 的 `modules.build` 不变。

```json
{
  "name": "remind",
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

- 只允许一个外置模块，不接受宿主文件路径；Module.builtin、保留名和领取时持久目标审计均复核，owner 身份不能绕过内置不可变规则。示例仅展示已安装外置 remind 的授权请求，不是执行授权。
- 同一工作区的 `requestKey` 是单次授权：相同请求重放返回原运行，即使它已失败或超时；不同内容复用该 key 被拒绝。不自动重试、续跑或更换模型。已有 stop-build 可停止；revise-build 不能续跑这种运行。
- 时限和提交上限在入队时检查不超过全局上限，作为内核审计记录保存；claim 时写入真实 deadline 与提交预算，不读取候选可修改的 request.json，不改变工作区全局设置。
- 仍使用现有每日预算、FIFO、单构建并发、执行模式、类型检查、作者测试与连续性检查。检查通过且无已有数据迁移或新增凭据时自动启用；需要确认时，审批绑定版本 hash。模型完成回复本身不等于检查或启用成功。
- Pi 必须支持逐次指定模型，发出 prompt 前核对实际 provider/model。不匹配直接失败。受控运行使用临时私有 Pi profile（凭据由 Pi 引用原 profile 管理），关闭自动重试与自动压缩；退出后清理临时 profile，不改服务 profile 的设置。

## 本地恢复

当正常服务入口不可用、需要恢复外置应用时，可在**服务停止、数据库已备份、没有 queued/running 工作或 building/testing 候选**的条件下运行：

```sh
chrona admin build /path/to/authorized-request.json
```

此命令不能修补或回滚内置入口；内置代码故障通过恢复服务发行资源处理，不接受旧 `rollback builtin`。使用与服务相同的 `CHRONA_DATA_DIR`、Provider、SDK、沙箱和资源配置。命令取得独占数据库锁，只启动该次构建与 loopback 的 run-capability 工具桥，不启动普通 tick、网页/QQ 常驻模块、内置模块升级、提醒、反思或其他作业。已有未完成工作时拒绝执行；失败不会自动继续。

候选通过后遵守与服务相同的启用规则：无需确认的版本自动启用；已有数据迁移或新增凭据仍需用户通过原有审批入口或 `chrona admin approve <approvalId>` 明确批准。恢复命令不代用户批准待确认事项。随后恢复线上服务或按部署流程切换，核对健康状态和版本。

## 验证

- 假 Provider 与真实测试沙箱：单次运行、预算绑定、重复 key、异常重放、拒绝续跑与实际检查；启用行为由统一模块检查路径决定。
- 假 Pi 子进程：精确模型参数、prompt 前模型核对、重试关闭、临时 profile 清理及原设置不变。
- MCP 作者测试：公开工具与参数转发。
- 不在自动测试中调用真实模型、QQ 或生产库。
