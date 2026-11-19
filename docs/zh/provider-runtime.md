# Provider 运行边界

通用 Agent API 和 Provider 登记归内核；具体后端、模型、命令、资源、凭据、会话协议和恢复策略归独立 Provider 应用。Chrona 仓库不携带具体 Provider 实现或默认配置，也不要求安装某个应用才能启动。

应用通过批准版本声明的登记工具提供能力。内核绑定真实应用身份、版本和回调合同，Run 持有授权、预算、租约和停止状态；应用参数、名称、模型输出或错误文字不能增加权限。应用移除或版本变化后，原绑定不得被同名替代者接管。

宿主对所有应用使用相同的 ModuleEntry、SDK 传输和后代进程监督。Linux 的 `CHRONA_HOST_GENERATION` 与 guardian 停止回执为通用运行证据，不再由具体 Provider 配置字段触发。未知停止仍占用容量，取消请求不等于停止确认。

内核在启动时将本轮工具定义及委托引用交给 Provider。Provider 用 `tool-delegation.invoke` 经 SDK 执行。内核检查 Run 状态、接收者及目标版本，按发起模块的权限执行，并在审计中记录实际接收者。登记过的 Provider 通过委托访问跨应用业务工具，平台接口与声明的 Web 页面注册仍可直接使用。Provider 私有配置通过应用私有数据和批准的凭据读取能力取得。

普通模块调用也可以在同步 `chrona.call()` 的 `delegations` 中传入参数名到工具目标的映射。内核把各工具换成绑定接收者和目标版本的引用，放入收件工具的同名参数。接收者在处理期间用 `chrona.invokeDelegated(reference, args, key)` 调用。外层调用结束或超时后，引用失效。同一个引用与 `key` 用于查询原效果或复用结果。

2026-11-17 本轮仅修改源码和静态核对；独立应用未构建、发布或部署，当前源树没有动态验证结论。旧具体 Provider、远程设备及固定应用组合记录从 Git 历史查阅。公开目标见[API 规范](kernel-api-design.md)，运行退出和数据恢复见[运维](operations.md)。
