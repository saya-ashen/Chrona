# 部署兼容修复

Pi 增加本地停服 owner 入口 `chrona admin install pi --update --exact-release --request-key <key>`。它选择当前发行 lock/bundle 的固定 commit，要求现用源码及未选中本地源码与发行 tree 相等，保留旧 Git 历史并经过既有构建、测试、审批及激活。普通 update 仍使用 merge；Provider 的发行身份合同未放宽。

异步构建、等待停止和审批期间复核原批准身份。恢复检查在等待身份的早退之前执行，身份变化会终结旧候选，新的 request key 可继续。类型定义留在已有 install-types 文件，避免循环依赖。

Apps 兼容材料只把旧 `web.component-set` 改为当前 `web.page-set` 登记。现有 UI、数据、配置及工具保持；原材料和新材料保存在任务目录，待正常 Author 提交与审批激活。生产材料净减 1 行，27 项脚本检查及当前 Web 登记合同检查已通过。

## 已运行检查

父助手接手后的 exact-final：16 pass、0 fail、93 assertions。完整 `verify:slice` 的 lint ratchet、TypeScript、guardrails（含依赖边界）通过；101 个关联测试文件中 100 个通过，未改动的 Web `settings-timeout.bun.test.ts` 在 `invalid 0 cannot save` 失败，独立补跑仍失败。此失败如实保留，不宣称本轮 slice 全绿。完整发行及实际生产验收结果随后追加。

之前的循环依赖失败、未完成检查和部署失败证据保留在任务目录，不作为当前通过证据。

## 执行顺序

按用户最新要求由父助手直接完成后续发行、备份与部署，取消部署前独立审核门槛。新主程序与 Pi 精确发行、Apps 候选使用正常生命周期，不直写 activeHash，不转换真实数据，不调用真实模型或 QQ，不回放两条保留 unknown 回执。部署后再清理本次新增的重复校验及无消费者包装，并报告实际净行数。生产当前状态和最终验收以部署记录为准。
