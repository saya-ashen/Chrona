# 2026-11-16 一次性存储转换

只在仓库中用 Bun 执行，不注册 `chrona` 命令、不导入运行时入口、不加入发行资源。脚本不会停止服务、部署、替换现有数据目录或激活应用。

```sh
bun scripts/one-off/storage-20261116/migrate.ts \
  --source /absolute/path/to/stopped-chrona-data \
  --destination /absolute/path/to/new-conversion-output
```

`--source` 是包含 `chrona.db`、`platform`、`sessions`、`secrets`、`qq-bot` 的数据目录。`--destination` 必须不存在，父目录必须已存在，并且与源目录互不嵌套。运行用户需要读取源数据、取得维护锁并写入输出目录的权限。

执行前停止 Chrona 和所属应用/Agent 进程，关闭自动重启。复用现有备份流程：维护锁阻止 Chrona 并发启动；Linux 还检查遗留进程的 cwd。cwd 检查不能识别已切换目录的进程，仍须实际停止整个服务进程组。脚本不把数据库中 `unknown` 的状态改为“已停止”。

转换成功的输出：

```text
new-conversion-output/
  original/
    chrona.db          # 转换前主库的一致快照
    chrona.db.tar      # 转换前 platform/sessions/secrets/qq-bot 备份
  data/                # 转换后的完整数据目录
    chrona.db
    platform/...
    sessions/...
    secrets/...
  migration-report.json
```

脚本只接受本次存储精简前的 `0001_initial` checksum `6d83f856…`，并固定目标 checksum `b254c9a1…`。未知来源、后续 schema、已有输出、混合新旧私有存储、重复 timer 标识、无应用上下文的未完成旧 Run、未解决的 standing approval 均明确失败。不得通过修改 checksum 绕过检查。

转换规则：

- 主库所有仍存在的表逐列复制，逐表比较行数及全部保留列的内容，再运行 `integrity_check` 和 `foreign_key_check`。身份、版本/hash、审批、回执/key/digest、队列、预算、租约、取消、停止证据和 remote-execution 八张表均原样保留，不运行留存清理，也不重新执行请求。Workspace 已有 settings 原样保留，新建记录使用新默认值。
- `Schedule.mode='timer'` 映射到 `Timer`，保留原主键、owner、rule/revision、payload、status 和调度时间，旧 `text` 映射到 `timerId`。唯一键冲突报错，不自动合并。其他旧日历记录，以及退役的 Message/Preference/Grant/BuildTargets/BuildRequest 和删去的列，保留在 `original` 备份与原始源目录；它们不会重新成为新内核的公开数据。
- 格式转换不创建新的恢复代次：原 `.chrona-restore.json`、`.mind-restore-review.json` 及其缺失状态原样保留，已有恢复阻塞也不自动解除。
- Mind 七个旧文件和 admission/verification 子日志合并到 `mind.sqlite`。三个 execution 表各自独立，允许不同 scope 有相同 id；其他表的内容、待办、预算和回执全部保留，重复表/未知 trigger/view 报错。核对后仅删除输出目录中的旧文件。
- 各应用 `conversations/state.json` 转为 `conversations/sessions.sqlite`，保留完整消息、turn、Run、cursor、固定请求和交付状态。使用实际应用读取器校验格式，不调用模型或工具。原 JSON 保留在转换前备份中。
- 其他应用私有库（包括 Chat）使用现有备份的一致 SQLite 快照，不改 schema。Provider session 文件、材料、设置和 secrets 按现有备份/恢复规则保存，不读取或输出凭据值。可重建的依赖目录、链接和临时文件沿用备份排除规则；被跳过的链接/特殊文件列在报告 `omitted`，可重建目录按既有规则直接排除。切换前检查这些项目，并按部署流程恢复所需依赖。

失败时不会发布目标目录；保留同级 `*.converting-*` 目录及 `status: failed` 报告供诊断，异常链给出具体原因。不要启动这个半成品。原始业务数据不改动；备份过程中只临时取得维护锁。成功输出以 `status: complete` 和逐表计数为准，存在数据库文件本身不表示转换完成。

切换是单独的部署步骤：检查报告和完整备份后，把 `data/` 部署回**原来的数据绝对路径**，使用匹配的新内核和经正常批准的应用版本。脚本保留已签定/固定请求中的绝对路径、版本材料和批准身份，不重写 hash、不授予新版本权限，也不把输出路径写进业务记录。因此不要直接在 staging 路径启动；旧已安装应用源码也不会被脚本自动升级，尤其 Mind 和入口应用必须与新布局匹配。若仍需运行旧版，使用原始数据/备份，不能让旧代码写已转换的新库。

测试只创建临时数据，不调用真实模型或 QQ：

```sh
bun test ./scripts/one-off/storage-20261116/migrate.bun.test.ts
```
