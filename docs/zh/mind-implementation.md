# Mind 普通可选应用实施与验收记录

日期：2026-11-09。**当前状态：实现与隔离验收完成，已部署到本地 3112 实例。** Mind 已安装并激活，自动检查和通知均保持关闭。

2026-11-10 的新内核源码适配见[普通应用迁移记录](application-migration.md)。本页的本地部署与真实实例状态只指上述 2026-11-09 版本；本工作分支后续的持久工具结果和分页游标改动尚未部署。2026-11-11 的持久 timer、恢复提示与隔离验证见[持续关注与恢复](continuous-steward-journey.md)。

Mind 是 `external/mind` 中的普通可选应用，不默认安装。整应用暂停名单仅保留 Remind。Agent 仍是唯一不可替换的 builtin 应用，Pi 仍是唯一内置 Provider；本轮没有新增内核公开工具。恢复 Mind 不增加离线来源数量，发行仍包含 13 个来源。

本轮使用新临时数据，不迁移旧 Mind 数据。发现旧 `agenda.json`、`decisions.json`、`state.json` 时明确拒绝，等待用户决定。没有恢复旧 `wakeProvider`、内核日历、全局聊天或内容读取接口。

## 行为与边界

- 关注项支持项目分组、目标、优先级、截止时间、预期进展、复查、暂缓和精确等待条件。来源模块身份来自真实 caller；事件、引用、线程、发送者、域及辅助文本共同匹配。关联只触发核实，不自动完成关注项。
- 来源通过已认证模块调用 `signal` 推送事件或有界摘要。尚未实现主动拉取来源的读取适配器。链接只保存来源、引用、版本、核实时间和结论，不提供调用权限。
- 未匹配消息进入有界每日复查。建议必须经用户接受才成为关注项；不按每条未匹配消息立即唤醒。
- 反馈区分新证据、进展、内部工作、重复、不可用、用户可见结果。不可用不记作负反馈，不推进成功检查或证据消费标记。独立重试等待从一小时退避至最多 24 小时；新的证据或关注项修订可触发重新检查。
- 低优先级重复消息仅在足够近期样本及衰减规则满足时延至每日复查。明确用户事项、截止时间和关键事项不受这种反馈抑制。
- 配置默认 `enabled: false`、`notifyEnabled: false`。普通后台检查受间隔、静默时段和每日预算约束；手动检查明确发起前台工作，仍受 Agent 和内核治理约束。

## 权限与工具

| 受众 | 工具 | 约束 |
| --- | --- | --- |
| owner 路由 | `ui-agenda`、`ui-dismiss`、`decisions`、`note`、`check`、`ui-settings` | 内核先验证当前批准的 owner 调用身份，入口只对这些路由传内部准入事实；Web 保留真实 module caller 和请求回执作用域 |
| 模块推理 | `agenda`、`propose`、`report` | Agent 只选择这三个 Mind 工具；普通来源不能读取私有 agenda，提交建议不等于修改关注项或产生可信报告 |
| 来源模块 | `signal` | 来源名称和 moduleId 取真实身份，输入不能伪造 caller；来源只能引用自己的信号提出建议 |

`propose` 只产生待确认建议，拒绝用旧 action/id 参数执行 owner 删除。用户忽略建议走独立 `ui-dismiss`。授权在回执重放之前核对。SDK 使用带代码的错误，保留 `invalid`、`forbidden`、`conflict`、`capacity`；输入、输出及持久化状态均有本地严格 schema 校验。

关注项及决策返回完整记录的有界分页，实际计算 UTF-8 编码的 `{result: ...}`，上限 230 KiB。`nextCursor`、`limited`、`total` 明确表示后续页；游标绑定状态修订，数据变化后须回到第一页。主页面提供第一页、下一页及部分结果提示。决策列表不返回提示词、启动请求键和内部报告候选。

## 持久化和真实结果

私有 `mind-v1.json` 采用严格版本 schema、串行事务、0600 文件、文件 fsync、原子替换及目录 fsync。状态损坏、权限异常、未知 schema 或不确定落盘均失败关闭，不清空重建。请求键对应精确参数和持久化回执，未知结果不换键重试。

Agent context/run 的键、提示词、工具选择和关注项修订在调用前落盘。同一时刻只有一个未决推理；重启后核对既有 run，或者以相同键重放创建。未知状态保留原槽位，不另起执行队列。报告最多保留八个候选，只有当前真实 Run 的持久 `tool-result` 事件中匹配成功、完整且未过滤的报告回执，并且 `agent.get` 确认为 finished 才应用；按分页游标事务性保存已读位置和已验证报告，重启不依赖 transcript 尾部。模型文字、失败工具结果、其他 run 和 owner 自述不能证明完成。报告不会自行把关注项状态改为 done。

状态上限 8 MiB；200 关注项、64 待处理建议、512 活跃信号、4096 归档事件身份、256 决策、1024 反馈和 2048 请求回执。失效或被新版本替代的信号可归档，但保护未决执行和待确认建议引用的证据，保留事件去重身份。结束建议可移除，原始请求回执保留。终态提示词按字节压力压缩，并为执行结算预留容量；保留 run 身份、可信报告和未知通知。无法安全回收时明确拒绝新工作。

Notify 为可选依赖。仅验证过且包含实际用户可见信息、证据可用的报告可提出通知；先落盘固定键和未知发送状态。未知发送不自动重复，Notify 接受不等同外部送达。

## 页面

Mind 注册主页面和 `purpose: settings` 设置页，使用现有 Web 声明式组件。设置在应用详情内嵌显示，仍由 Mind 保存。页面覆盖关注项创建编辑、项目、证据、建议接受/忽略、决策、分页、等待及未知状态。数值表单以十进制字符串输入，应用校验范围后保存数字。没有 iframe、中央业务配置表或额外特权 Web 适配器。

## 验收记录

所有验证使用临时数据库和数据目录；重检查通过 `/tmp/chrona-permanent-check.lock` 串行、设置内存上限。计数不累加重试，也不把重叠套件相加。

| 检查 | 当前证据 |
| --- | --- |
| 独立策略回归、后端、运行时失败场景 | 36 pass；`.tmp/mind/runtime-followup-tests.log`，含 21 独立回归及 13 运行时专项测试 |
| UI 与本地离线检查 | UI 12 pass；后端 2 pass，内部 17 个离线场景；`/tmp/chrona-mind-service-focused.log` |
| 最终静态检查 | PASS：`bun scripts/chrona.ts check all`；`/tmp/chrona-mind-static.log`，0 errors、36 条依赖规则 warning |
| 最终受影响 Bun 测试 | PASS：7 文件 61 pass、0 fail；`/tmp/chrona-mind-focused.log`。另在提取私有准入证明后，Agent 工具／路由／Mind 页面 3 文件 51 pass、0 fail，`/tmp/chrona-mind-entry-proof.log`；两组存在重叠，不相加 |
| 完整服务器 API | PASS：19 文件 111 pass、1 skip、0 fail；`/tmp/chrona-mind-api.log` |
| 三种尺寸真实浏览器 | PASS：95 项、0 fail、`sourceDrift: []`；`.tmp/mind/browser-run-1794214050/report.json` 及同目录 `gallery.html` |
| 13 来源和 Linux 发行构建 | PASS：`/tmp/chrona-mind-build.log`，`BUILD_EXIT=0` |
| 真实发行包离线安装、批准激活、页面和重启回执 | PASS：`/tmp/chrona-mind-release-smoke.log`，`SMOKE_EXIT=0`；实际检查安装、批准、页面绑定读取、0600 文件、相同键重放、改参数 409 和重启持久性 |

最终串行入口为 `.tmp/mind/final-acceptance.sh`。浏览器使用真实 Mind/Web SDK 和渲染器，Agent 及有限内核记录为离线替身；真实 HTTP/准入另由生产 Hono、SDK、SQLite 测试和发行包安装冒烟验证。没有真实模型调用、外部账号发送、现有用户数据迁移、部署或 push；此记录不能作为这些事项的验收证明。


## 最终发行与验收补充

- 发行文件：`dist/releases/chrona-linux-x64/chrona`，SHA-256 `ae7af15e474b9e8d46fd8ffc4fc5abfc2c9e77686fae5ca8fce330982ff7d40a`。
- Mind 离线来源 commit：`b2b81b50698486916f9fb06067e860f1a0ab948b`；bundle SHA-256 `12514eb6c2cd72c242e563addfd5f6758e6c0061e0fbbdb8733f7d698e4eada0`。实际安装使用声明的 `zod: 4.3.6` 和锁文件，执行离线冻结安装；不依赖仓库根目录的 node_modules。
- 实际发行安装发现并修复页面 `layout` / `purpose` 的类型扩大问题。先前安装失败的运行保留为失败证据，最终成功来自重新构建后的一套全新临时数据。
- 激活哈希写入早于 activated 处理结束。发行夹具等待激活投递验证完成后才发起独立 owner HTTP 请求，避免将页面注册中的同步环拒绝误当成安装完成后的读取结果；没有绕过或放宽环检测。
- 独立 Agent context 的自身应用工具调用经真实持久化 run、原始模块身份、工具选择、租约、期限和取消状态检查后，才获得精确 origin 的临时宿主证明。证明放在私有叶子文件以避免循环导入；不能从 JSON 参数构造、传给子调用或复用到其他数据库。普通同步自身调用、嵌套环和跨事件等待环继续拒绝。新增准入证明后的专门回归已重新通过。
- 本轮未调用真实模型，未激活现有实例中的 Mind，未迁移旧 Mind 文件，未部署、提交或推送。发行烟雾测试的临时数据在结束后删除。


## 本地部署记录

- 部署完成时间：`2026-11-09T09:03:52.553652+00:00`；实例 `chrona-kernel-preview.service`，端口 `3112`。旧 `chrona-v1-preview.service` 保持停止，3111 未重新启动。
- 已核对实际运行进程的二进制 SHA-256 为 `ae7af15e474b9e8d46fd8ffc4fc5abfc2c9e77686fae5ca8fce330982ff7d40a`，Mind 激活 commit 为 `b2b81b50698486916f9fb06067e860f1a0ab948b`。通过停止服务后的正式检查安装和精确候选批准完成部署。
- 原有应用身份、应用版本、Agent 模型策略、记忆偏好、Notify 设置、内核预算及服务环境文件保持不变；现有数据保留。Mind 使用新的私有数据，未迁移旧实例中的 Mind 文件。
- 部署后核对：9 个应用激活、5 个公开内核命名空间和 32 个工具、MCP 24 个工具、Coding 只读协议、六个应用设置页及页面身份/版本绑定读取、Mind 空白关注列表、鉴权拒绝和 Pi 可用性。Run 总数未增加，未调用真实模型。
- 线上 Chromium 桌面/手机只读检查共 12 项通过，无页面异常、iframe 或横向溢出；报告 `.tmp/mind/live-readonly/report.json`。没有通过浏览器保存或开启自动检查。
- 停机冷备份：`/home/saya/workspace/Chrona/.tmp/kernel-minimization/local-deploy/rollback-mind-20261109T090337Z`，包含部署前的数据、配置和发行文件。
- 部署脚本 `.tmp/mind/deploy-local.py`；机器记录 `.tmp/mind/local-deployment.json`；日志 `/tmp/chrona-mind-local-deploy.log`。前文“未部署”描述限定为隔离验收阶段，此节记录随后明确授权的本地部署。
