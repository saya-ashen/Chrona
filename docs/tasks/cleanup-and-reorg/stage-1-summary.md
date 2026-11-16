# 阶段 1：可信验证基线

阶段 1 已完成，基准 `6966a5c3`。实际执行文件、门禁退出码和制品 digest 见 `stage-1-evidence.json`，范围与历史失败见 `verification.md`。

主要变化：

- 正式发行入口保存执行范围、逐步日志和退出码；全库 lint 债务独立报告，任何测试、检查或构建失败立即阻止后续发行步骤。
- Bun / API runner 支持只列实际文件；补入 Chat 三个既有测试和数据库安全测试。
- 根据生产合同修正陈旧 fixture，保留所有关键业务断言。唯一生产行为修复为离线迁移工具逐个完整读取会话，拒绝摘要查询漏掉的坏 turn；仅临时数据验证，没有运行真实转换。
- 重建 Web 页面制品及候选应用 bundle，全部继承既有七个应用历史。旧 lock 与当前源码原已存在未同步差异，详细差异统计见证据文件，不将全部应用差异归因于本次测试修正。
- Web shell 60 项、Pi/Notify 三尺寸六场景、desktop 离线 build 与 3 tests 通过；不代表真实账号或部署验收。

验证成功：347 文件 Bun 全量、21 文件 API 全量、check all、verify:slice（21 关联测试文件）、原生 Linux x64 build、packaged smoke。全库 lint 保留 195 errors / 1036 warnings；依赖边界 0 errors / 47 warnings。没有更改 lint 规则或缩小已有覆盖以通过。

独立只读审查覆盖 fixture 更新、迁移验证、stop/fence、真实 SDK Provider 替身、发行脚本与同源设置浏览器测试，未发现实质问题。真实模型和真实 Pi 可选路径未运行；无部署、推送或真实数据操作。
