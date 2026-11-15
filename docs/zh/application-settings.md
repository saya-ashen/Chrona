# 应用设置与导航

> 当前状态：Coding 与 coding-web 已退役，包含旧 work-v2；当前 Chat 独立拥有会话与执行记录。本文的 Coding/Editor 接口、源码路径、验收和部署描述仅作历史记录，不是现行接入指引。详见[Coding 退役说明](coding-retirement.md)。

状态：应用设置与应用详情内嵌设置均已于 2026-11-09 部署至本地 3112 预览实例，线上只读浏览器确认通过。

用户批准的目标是：打开应用即可找到自己的设置；从全局设置和应用详情进入时，使用同一份应用设置页。

## 所有权

- 全局设置读取和修改内核的预算时区、模型硬额度、用量与可选任务总时限，不批量保存 Agent、Notify 或 Web 的业务偏好。任务总时限默认留空，不限时；详见[任务总时限](task-timeout.md)。
- Agent 保存模型分层、思考等级与首选超时；Notify 保存通知策略；Web、MCP、QQ 分别保存各自入口的记忆偏好。存储位置与授权检查仍由对应应用负责。
- 凭据、部署环境变量和模型硬额度有各自的管理入口，不混入应用记忆设置。

## 页面契约

应用通过现有 `web.page-set` 注册自己的声明式页面，明确设置 `purpose: "settings"`。这属于普通 Web 应用协议，不增加内核工具或命名空间。每个应用最多有一份设置页，相同页面 ID 可更新。

Web 保留页面的真实应用身份、版本与工具合同绑定，负责统一外壳、导航和表单交互。页面只调用所属应用的工具。停用、删除或合同失效后的页面不能继续作为有效设置使用。

全局设置中的应用索引、应用详情的“设置”标签、注册页面的设置入口统一进入 `/apps/<moduleId>?tab=settings`，在应用详情标题和标签栏下内嵌同一份应用设置页。独立 `/p/<module>/<page>` 地址继续可用。内嵌复用应用页面渲染器、私有表单状态与带页面版本绑定的调用，不复制表单、不使用 iframe。未提供设置页的应用会显示明确状态，不根据工具名猜测设置能力。

## 独立保存

各应用的表单单独读取、校验和保存，并显示成功或失败。一个应用保存失败不会触发其他应用的写入。Agent 的表单沿用 `configure` 的原始调用授权，首选超时仍受内核硬额度约束。

Web 的本地记忆配置通过 `web.ui-settings` 保存；记忆应用持有的偏好记录通过独立的 `web.ui-preferences` 读取和删除。后者读取失败不会把已经成功的本地保存显示为失败。页面注册列表与打开页面共用身份、工具合同和页面校验，失效页面不会继续出现在设置导航中。

## 验收记录

- 浏览器：`.tmp/application-settings/run-1794202040/report.json`，122 项通过、0 失败，覆盖 1440×900、1024×768、390×844。五个应用从全局索引、应用详情进入同一页面，保存后重载、失败反馈与保留输入、缺失页面与失效合同、手机无横向滚动均通过；`sourceDrift` 为空。
- API 回归：`/tmp/chrona-settings-api.log`，19 个文件、111 通过、1 跳过、0 失败，`API_EXIT=0`。
- 静态检查：`/tmp/chrona-settings-static-final-accepted.log`，`STATIC_EXIT=0`；30 条既有依赖警告、0 错误。
- 打包：`/tmp/chrona-settings-build-final.log`，13 份离线 Git 源与 Linux x64 二进制构建通过。初次隔离验收二进制 SHA-256：`a0f41eb7b88c2c1ccdc4c208e2ed5fe1532aadcf50f7148d9b9cc88131e77e71`；后续更新检查修复的发行包见下文。
- 应用测试：16 个文件共 102 项通过。`/tmp/chrona-settings-focused.log` 中其余 15 个文件通过；`lifecycle.bun.test.ts` 的旧断言仍期待设置标签显示概览内容，已按新设置页面行为修正，单独重跑 22 项通过，见 `/tmp/chrona-settings-lifecycle-final.log` 的 `TEST_EXIT=0`。原批次失败记录保留，没有将其改写为成功。
- 打包安装冒烟：`/tmp/chrona-settings-release-smoke-final.log`，`SMOKE_EXIT=0`。使用新临时数据库和实际二进制完成离线安装、检查、启用审批；五个应用均登记设置页，全局接口拒绝混入应用设置。并回归验证 Coding 的真实 Agent 项目入口、HTTP/应用共同会话、收据重放与冲突、注册页面。没有真实模型调用。

安装验收曾发现 MCP/QQ 页面对象的 `layout` 与 `purpose` 被 TypeScript 推断成普通字符串，导致实际安装检查拒绝候选。已经显式保留字面量类型，并重新打包、使用全新临时数据库验证成功。

浏览器使用真实应用源码、SDK、注册、私有存储和 Web 渲染器，内核与 Agent admission 为离线替身；Agent 拒绝为模拟，Notify 无效输入使用实际校验。生产权限另由应用路由测试和 API 回归验证。浏览器未覆盖真实 QQ 凭据、MCP 外部传输或记忆提供者服务。

隔离验收不调用真实模型，不使用现有用户数据库，也不修改运行中的 3111/3112 服务。

## 本地部署更新检查

用户随后批准部署至现有 3112 预览实例。首次更新被检查阻止，已恢复原发行包和停服数据备份，3111 未改动：

- Web 的合同变化触发内置 Agent 依赖类型检查，发行包中的 Agent 源码缺少源码树相对路径下的宿主类型依赖。修复须保留实际 Agent 源码与候选合同检查，不能忽略缺失依赖或不兼容输出。
- Notify 的作者测试使用固定通知键并假设数据库为空，在非空数据副本上失败。修复先验证传入副本的完整性、既有记录、设置与读取接口，再在独立临时目录中运行业务场景；不清空通知或改写既有偏好。

Notify 的两个作者入口已在停服备份的临时副本上通过，副本在验证后删除，见 `/tmp/chrona-settings-notify-backup-copy.log`。

补充修复的检查结果：

- 内置 Agent 检查与既有合同影响测试：24 项通过；覆盖独立编译的二进制、候选 Web 合同、真实宿主类型、不兼容输出和缺失依赖。没有跳过受影响调用方或屏蔽诊断。
- Notify 六组测试：35 项通过；覆盖非空存储、重复作者测试、原通知与配置逐项保持不变，以及缺少迁移、损坏设置时仍拒绝候选。
- 静态检查：`/tmp/chrona-settings-deploy-static.log`；类型、lint ratchet 通过，30 条既有依赖警告、0 错误。
- API 回归：`/tmp/chrona-settings-deploy-api.log`，111 通过、1 跳过、0 失败，`API_EXIT=0`。
- 重新打包：`/tmp/chrona-settings-deploy-build.log`，`FINAL_BUILD_EXIT=0`；13 份离线 Git 源与 Linux x64 二进制构建成功。
- 新发行包的隔离安装冒烟：`/tmp/chrona-settings-deploy-smoke.log`，`SMOKE_EXIT=0`；五份设置页、全局内核设置、Coding/Agent 项目入口及共同会话检查通过，0 次实际模型调用。
- 新二进制 SHA-256：`5b13a2eb77aae999c7db14b129116422e007db998eabbe13e1088b39c34ddd36`。

第二次部署已通过 Web/Notify/MCP/QQ 的更新检查和注册，最后逐项读取设置页的数据时发现 Web 自身设置请求触发 `cycle`（HTTP 409）；部署脚本再次自动恢复原发行包与停服数据备份。浏览器隔离路由未模拟内核循环保护，原来的注册检查因此不足以覆盖此问题。修复在 Web 完成原有工具发现、当前已批准 owner 权限与页面合同检查后，直接分发自身的 `ui-settings` 和 `ui-preferences` 业务函数，并按发现的输入、输出合同验证。未改动内核循环保护。

新增真实 HTTP/SDK 回归先复现 `409 cycle`，修复后 3 项通过；连同 Web 设置、设置页、页面生命周期、owner 与循环调用相关检查，共 79 项通过。覆盖私有文件保存及重启读回、401、旧页面或合同变化 409、无效输入/输出，以及撤销 owner 权限后的拒绝行为。后续打包验收还增加实际鉴权 HTTP 下五份设置页的数据读取、Web 偏好读取与页面合同绑定检查。完整追加验收已通过：`/tmp/chrona-settings-self-static.log` 为 `STATIC_EXIT=0`（33 条依赖警告、0 错误）；API 111 通过、1 跳过、0 失败；重新打包及扩展后的安装冒烟均为 0 退出。浏览器报告 `.tmp/application-settings/run-1794204715/report.json` 为 122 通过、0 失败，`sourceDrift: []`；其隔离路由限制同上，实际权限与循环保护由新增生产 HTTP/SDK 回归补充覆盖。最终二进制 SHA-256 仍为 `5b13a2eb77aae999c7db14b129116422e007db998eabbe13e1088b39c34ddd36`，Web 离线源已包含本次分发修复。

## 本地部署结果

2026-11-09 06:13:46 UTC 部署成功，目标 `127.0.0.1:3112`，服务为 `chrona-kernel-preview.service`。部署同时包含此前已验收的 Editor 退役清理。

- 已核对运行进程 `/proc/<pid>/exe` 的 SHA-256，匹配最终发行包 `5b13a2eb77aae999c7db14b129116422e007db998eabbe13e1088b39c34ddd36`。
- Web、Notify、MCP、QQ 通过停服检查式更新，Agent 随主程序更新；原应用 ID、私有模型/记忆/通知配置、内核额度、服务环境文件保持不变。
- 五份设置页已注册、可打开，并通过各自 owner 工具的只读数据检查。全局设置仅返回内核设置。
- MCP 24 个工具、Coding 项目/会话只读入口、5 个内核命名空间/32 个工具均通过。缺失或错误密钥返回 401；Pi 可用，模型仍为 `krill-ai-codex/gpt-6.1-sol`，未调用实际模型。
- `3111` 健康检查为 200，未更新该实例。
- 原数据目录继续使用 `.tmp/kernel-minimization/local-deploy/data-permanent-20261109T004701Z`。
- 停服回滚备份：`.tmp/kernel-minimization/local-deploy/rollback-settings-20261109T061306Z`，包含原发行包、完整数据和服务环境文件。

部署与检查记录：`.tmp/application-settings/local-deployment.json`、`.tmp/kernel-minimization/local-deploy/deployment.json`、`.tmp/kernel-minimization/local-deploy/smoke.json`；日志 `/tmp/chrona-settings-local-deploy-success.log`。未提交或推送代码。

## 应用详情内嵌设置调整

用户随后要求设置与概览、活动等标签保持相同的详情外壳。设置标签现在保留应用标题和标签导航，在下方直接渲染应用登记的设置表单；全局索引、概览入口及普通应用页的设置按钮均进入 `/apps/<moduleId>?tab=settings`。独立页面地址仍可打开。

内嵌页与独立页共用 `registeredDeps` 和 `PageView`，读写请求保留 `{module, id, revision}` 页面绑定。应用表单使用普通组件注册表和独立状态容器，不能借用系统操作组件。应用或活动版本变化时重新建立表单；离开页面后的迟到读取、保存响应不会覆盖新页面或触发旧页面导航。普通详情刷新保留当前草稿。页面或合同失效会保留详情标题、标签并显示错误和显式重试入口。

本轮部署前隔离验收：

- 五应用浏览器：`.tmp/application-settings/run-1794206271/report.json`，最终源码复验 185 通过、0 失败，覆盖桌面、平板、手机，`sourceDrift: []`。包括原有保存、重载、拒绝反馈以及内嵌导航、浏览器前后退、切换应用、迟到响应和失效合同。手机外壳导航在注册页面较多时改为换行。
- 外壳浏览器：`/tmp/chrona-inline-shell.log`，50 项通过；设置页保留详情标签，无 iframe。
- 页面与生命周期回归：`/tmp/chrona-inline-tests.log`，13 项通过，其中内嵌浏览器用例覆盖页面身份、版本、私有状态、图片路径、重试、停用与卸载后的响应隔离。
- API 回归：`/tmp/chrona-inline-settings-api.log`，111 通过、1 跳过、0 失败，`API_EXIT=0`。
- 静态检查：`/tmp/chrona-inline-settings-static-complete.log`，最终源码复验 `STATIC_EXIT=0`，33 条依赖警告、0 错误。
- 发行包：`/tmp/chrona-inline-settings-build.log`，`BUILD_EXIT=0`；13 份离线源和 Linux x64 构建成功。Web 离线源提交 `46b8238d6fe03a957c84580b69a9ccd1d1039a0e`。主二进制 SHA-256 仍为 `5b13a2eb77aae999c7db14b129116422e007db998eabbe13e1088b39c34ddd36`，本轮 Web 变化位于随包离线源。
- 发行包安装冒烟：`/tmp/chrona-inline-settings-release-smoke.log`，`SMOKE_EXIT=0`；新临时数据中完成实际检查式安装、启用、鉴权与五应用设置读取，并回归 Coding 共同会话和收据行为，0 次模型请求。构建曾在并行收尾测试文件时因源与离线种子不一致而拒绝产物；文件稳定后已重新构建并完成此验收。

浏览器仍使用真实应用、SDK、私有存储和渲染器，内核与 Agent admission 使用离线替身；生产鉴权和页面合同检查由 API 回归与发行包冒烟补充。上述隔离验收未修改 3111/3112 服务或用户数据；随后经用户明确批准完成下述部署。

## 内嵌设置部署与双实例核对

2026-11-09 06:48:13 UTC，内嵌设置部署成功。仅通过停服检查式安装更新 3112 的 Web 应用，活动源提交为 `46b8238d6fe03a957c84580b69a9ccd1d1039a0e`；其他应用版本、全部应用 ID、模型/记忆/通知配置、内核额度、数据目录和环境文件均保持不变。主二进制 SHA-256 仍为 `5b13a2eb77aae999c7db14b129116422e007db998eabbe13e1088b39c34ddd36`。

- 运行进程二进制、实际 HTTP 返回的 `app.js`、`pages.js`、`style.css` 均与验收发行包一致。
- 五份设置页通过页面身份和 revision 绑定的只读工具调用；五个应用详情设置地址返回成功。Coding 只读、MCP 24 工具、5 个内核命名空间/32 工具、鉴权 401 和 Pi 可用检查通过，无实际模型请求。
- 线上 Chromium 只读确认：桌面和手机各打开五份内嵌表单，保留应用标题和标签、无 iframe、无横向溢出、无页面异常；共 10 项通过。未点击保存。记录 `.tmp/application-settings/live-inline-readonly/report.json`，同目录含截图。浏览器请求仅允许本实例与已知设置读取，阻止其他写入和外部网络。
- 停服备份 `.tmp/kernel-minimization/local-deploy/rollback-inline-settings-20261109T064750Z`；部署记录 `.tmp/application-settings/inline-local-deployment.json`，日志 `/tmp/chrona-inline-settings-local-deploy.log`。

用户同时要求比较 3111/3112，仅在没有区别时关闭一个。实际读取服务、二进制、数据库和接口后确认两者不同：

| 项目 | 3111 | 3112 |
| --- | --- | --- |
| 服务 | `chrona-v1-preview.service` | `chrona-kernel-preview.service` |
| 版本 | 精简前旧版，二进制 `2f1692b5…` | 当前精简版，二进制 `5b13a2eb…` |
| 接口发现 | 13 个条目/78 个工具，含旧业务接口和私有宿主条目 | 5 个公开内核命名空间/32 个工具 |
| 应用 | 12 个，含旧 Editor/Mind/Remind | 8 个，含 Author 与独立 coding-web |
| 主数据库记录 | 11 个 Run、11 个 Session、4 条 Message | 此次核对时上述记录均为 0 |
| 数据目录 | `/home/saya/.local/share/chrona-v1-preview/data` | `.tmp/kernel-minimization/local-deploy/data-permanent-20261109T004701Z` |

两者使用相同的 Pi 命令与模型 `krill-ai-codex/gpt-6.1-sol`；3112 的 Pi 启动路径位于 3111 的安装根目录。两者不是同版本或同数据的重复实例，不满足此次“没有区别就关掉一个”的条件，因此保留 3111 原状，未停止或删除任一实例。两端 `/health` 均为 200。比较记录 `.tmp/application-settings/instance-comparison-before.json` 和 `instance-comparison-extra.json`；仅保存非敏感元数据，没有保存密钥或消息正文。

## 旧版本停止

用户随后明确要求关闭旧版本。已停止 `chrona-v1-preview.service`（3111）并取消开机自启：服务 `inactive/dead`，`MainPID=0`，端口不再监听。停止前确认无未结束 Run。旧数据库、消息、安装目录和恢复文件全部保留；3112 依赖的旧安装目录内 Pi 启动文件也保留。

停止后确认 `chrona-kernel-preview.service`（3112）仍运行，`/health` 为 200、Pi 可用，五份应用设置页正常。没有调用实际模型。记录 `.tmp/application-settings/old-instance-stopped.json`。如需恢复旧实例，可执行 `systemctl --user start chrona-v1-preview.service`；当前未重新启用其开机自启。
