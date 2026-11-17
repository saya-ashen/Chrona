# 模块源码与 Git 工作流

当前开发固定输入覆盖 13 个独立应用，发行选择其中七个；Pi 是普通 Provider 应用，更新使用相同受控生命周期。来源与恢复入口见[独立应用](independent-applications.md)。发行 lock 中的 `repository` 表示该固定发行提交的公开核验结果，实例中的远端关联单独保存在 `ModuleUpstream`，两者不能混为一谈。发布种子流程见[模块 Git 种子与官方发布](module-git-release.md)。

## 源码、运行版本与数据

每个应用按数据库 `moduleId` 拥有独立 bare 仓库：

| 路径 / 标识 | 用途 |
| --- | --- |
| `<dataDir>/platform/repos/<moduleId>.git` | 源码历史；`refs/heads/local` 是本地提交分支，没有可直接编辑的工作树 |
| `ModuleVersion.hash` | 新版本使用完整 40 位 SHA1 Git commit；旧版本保留原 64 位标识 |
| `<dataDir>/platform/staging/<versionId>` | 临时构建和检查目录 |
| `<dataDir>/platform/store/<hash>` | 受检运行产物，包括构建时安装的依赖；不是可编辑源码历史 |
| `<dataDir>/platform/data/<moduleId>`、`content/<moduleId>` | 应用数据与内容，独立于 Git 和代码版本 |

`local` 最新提交、已通过检查的版本和 `activeHash` 是三个不同概念。提交或 fetch 不会直接切换运行代码；运行时仍由数据库中的已批准版本和现有激活流程决定。版本列表公开已有的 `{commit, tree}` 来源信息，不公开宿主仓库路径。

新旧源码版本输入兼容 40 / 64 位。`contractHash`、文件 SHA256、内容摘要、补丁摘要和 bundle 校验值仍保持原校验规则，不因源码改用 Git 而改成 40 位。没有数据库迁移，也不重写旧版本标识、审批或 active 身份；验证导入可以补充 Git 来源元数据。

## 应用身份与更新

预装应用不因发行身份获得额外权限。普通应用通过源码提交、检查、审批和激活流程更新；Git fetch 或 push 不会切换运行代码。现有应用的本地修改与停用状态不会因远端关联而被覆盖。

## 取出、编辑、提交、检查

通过已有模块工具操作，不要直接修改 bare repo 或 store：

1. 通过 Author 读取准入覆盖的精确基线，或从独立应用仓库取得源码；在当前 Agent 已有工作区编写、构建和测试。
2. Author 导入完整源码及运行材料，真实 owner 入口按当前合同签发绑定提交者、全部目标及基线的材料准入。
3. Author 以实际应用身份提交整个固定集合，用原 request key 和 receipt 查询检查、审批与激活。丢失回复不换 key 重投。
4. 激活后核对实际版本、页面及业务行为；检查通过和审批通过分别只有其自身证明范围。

当前参数见[对话创作](author-current-conversation.md)、[版本材料](author-version-materials.md)及 [API 规范](kernel-api-design.md)。旧 `modules.checkout/propose/check/build` 不再是公开入口。

同名卸载后重装的外部应用拥有新 `moduleId`，不会继承旧仓库、提交回执或安装身份。

## 关联远端与显式推送

本机所有者可以使用 CLI 关联现有 GitHub HTTPS 仓库。写操作需要先停止使用同一数据目录的服务，并使用该实例的 `CHRONA_DATA_DIR` 与 `DATABASE_URL`。它们不读取 Provider 凭据；推送认证使用本机已登录的 GitHub CLI。

```sh
chrona admin git-associate notify https://github.com/chrona-core/chrona-module-notify --branch main
chrona admin git-status notify
git ls-remote https://github.com/chrona-core/chrona-module-notify refs/heads/main
chrona admin git-push notify --commit <完整源码提交SHA> --expected-remote <已观察的远端SHA>
```

关联先验证分支及共同历史，再登记来源。它不改变本地源码分支、审批或活动版本。已有其他来源时拒绝覆盖；关联失败不会冒称成功。状态中的本地提交、活动版本和远端提交分别报告，远端状态需要以命令实际联网检查的结果为准。

`git-status` 仅返回本机保存的状态（`remoteChecked: false`），使用上例 `git ls-remote` 确认远端分支后再填写 `--expected-remote`。推送必须明确选择本地源码历史中的完整提交与预期远端提交，只允许保留远端历史的快进。远端变化、历史分叉或无法确认结果时停止，重新查询后再决定下一步；不强制覆盖、不自动重试。安装、启动、检查和激活均不会自动推送。推送完成仍需核对远端实际提交。

应用离线更新保留已登记的远端关联，不用发行包中 `repository: null` 清除它。同名卸载后重新安装会获得新身份，需要重新关联。没有对应旧仓库的应用不会自动创建仓库。

## 显式读取和合并上游

内部 `modules.upstream` 服务使用已登记的可信来源，不接受调用方覆盖 repository、branch、URL 或宿主路径。它的三个内部 action 为（不新增公开内核工具）：

| action | 参数 | 行为 |
| --- | --- | --- |
| `status` | `moduleId` | 返回登记来源、本地 commit 和已有 upstream ref；不联网 fetch，也不表示远端此刻可达 |
| `fetch` | `moduleId` | 显式获取登记分支的上游候选；保留本地分支和 active 代码 |
| `merge` | `moduleId`、`commit`、`baseHash`、`requestKey` | 将指定 upstream commit 与本地历史合并，提交同一检查队列 |

这些是内部服务能力，当前公开内核路由不提供 `modules.upstream` 工具。关联与推送使用上面的本机所有者 CLI；源码修改继续走已有 Author 材料和受检提交流程。内部合并仍须绑定所观察的活动版本及幂等请求键；历史分叉或冲突不允许自动覆盖。

发行 catalog 的 `git.repository: null` 明确表示未发布的本地来源。bundle 可用于离线安装，不意味着 GitHub 仓库已存在或在线 fetch 可用；没有已登记 repository 时不会冒称可以联网更新。

## 离线更新与旧版本

离线安装使用停服 owner CLI `chrona admin install <package> --request-key <key>`；已有应用显式 `--update` 将固定发行候选交给正常 Git 合并与检查流程，不用发行快照覆盖本地定制。Pi 的 `--exact-release` 选择仅适用于真实发行固定 commit、批准身份及源码全等条件，仍经过正常检查与激活。详见[运维](operations.md)。

新安装、提交、导入及上游操作需要可执行的系统 Git。Git 缺失时明确失败；已有 store 中的受检版本与仍有匹配可信资源的 legacy 内置运行不要求先完成源码 Git 导入。普通应用的启动登记不会为了跟进新发行而 fetch 或覆盖当前版本。预装 Pi 同样保留用户选择，不在启动时自动补装或覆盖。

旧 64 位记录只有在原有源码能按原摘要规则验证时才可导入 Git；原 hash、审批和 active 身份保持不变。旧内置可能没有 store 源码，源码读取须核对原 hash 对应的可信发行资源。失源或摘要不匹配需要明确诊断，不能取当前新发行或 upstream 冒充旧历史；缺失旧源码也不能被描述为已经迁移成功。

Git 和 `modules.rollback` 的代码版本切换不等于恢复应用数据。数据 schema、快照恢复、审批及日程兼容继续由现有生命周期检查，不能用代码回滚承诺撤销数据变化。备份应保留整个数据目录中的源码仓库、运行产物和应用数据，详见[运维说明](operations.md)。

当前实现的自动化检查使用临时仓库、临时数据库和受控测试进程；不据此宣称所有平台打包、真实账号、公开上游、安装部署或真实数据升级已通过验收。
