# 模块源码与 Git 工作流

本文描述当前开发实现，不代表 Chrona 已正式发布或部署。十一项应用的官方仓库已发布到 GitHub `chrona-core` 组织；固定提交、完整离线 bundle 和许可通知保存在 `resources/module-git/`，构建默认使用这些固定输入。发布与核验方式详见[模块 Git 种子与官方发布](module-git-release.md)。

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

## 五个内置应用可以定制

`web`、`mcp`、`files`、`notify`、`events` 保留 `builtin` 来源及删除、重新安装保护，但其真实已存在的身份可以 build、propose、group、activate、update 和 rollback。空工作区中不能抢占这些名字，外部应用不能靠同名或伪造源码来源获得内置身份。

内置登记只负责可信发行资源的首次 Git seed。已有 active 版本（包括停用版本和定制版本）不会因新发行、元数据变化或上游不可达而被自动覆盖或暂停。首次 seed 和受检定制版本从 store 运行；旧 64 位内置版本保留严格匹配其原 hash 的可信资源读取路径。

kernel 系统接口与 `rescue` 仍受保护，不拆成可更新应用。这里没有更改系统权限、凭据、审批或数据迁移规则。

## 取出、编辑、提交、检查

通过已有模块工具操作，不要直接修改 bare repo 或 store：

1. `modules.checkout` 将 active 或指定版本的源码取到调用方工作目录中的空目录。`source: "builtin"` 读取当前发行参考，不代表当前定制版本，也不会激活代码。
2. 编辑取出的源码，使用 `modules.propose` 提交目录与变更意图。有效候选生成 Git commit，再进入既有构建、测试和检查队列。无效 manifest 可以返回 `rejected` 且没有模块身份，不构成有效版本。
3. 用 `modules.check` 检查候选的状态、测试及错误。检查通过的普通更新自动激活；新增凭据或已有数据迁移继续要求现有用户决策。
4. 激活后确认实际 active 版本和运行健康状态。`modules.build` 也使用同一受检生命周期。

以下是工具参数示例，目录相对于调用方工作目录：

```json
{"module":"files","dir":"files-edit"}
```

上述参数用于 `modules.checkout`；编辑后向 `modules.propose` 传入：

```json
{"dir":"files-edit","intent":{"changes":["调整文件展示"],"preserves":["保留现有文件和数据"]}}
```

同名卸载后重装的外部应用拥有新 `moduleId`，不会继承旧仓库、提交回执或安装身份。

## 显式读取和合并上游

`modules.upstream` 使用已登记的可信来源，不接受调用方覆盖 repository、branch、URL 或宿主路径。它的三个 action 为：

| action | 参数 | 行为 |
| --- | --- | --- |
| `status` | `moduleId` | 返回登记来源、本地 commit 和已有 upstream ref；不联网 fetch，也不表示远端此刻可达 |
| `fetch` | `moduleId` | 显式获取登记分支的上游候选；保留本地分支和 active 代码 |
| `merge` | `moduleId`、`commit`、`baseHash`、`requestKey` | 将指定 upstream commit 与本地历史合并，提交同一检查队列 |

先从模块列表取得真实 `moduleId`、`activeHash`，再调用：

```json
{"action":"status","moduleId":"module-example-id"}
```

需要在线检查时明确调用 `fetch`。审阅返回的 `fetchedCommit` 后，才能将该 40 位值作为 `commit` 提交 `merge`；`baseHash` 使用当时观察到的 active 40 / 64 位版本，`requestKey` 是本次操作唯一且可复用的回执键。例如下面的两个 hash 必须替换为实际观察值：

```json
{"action":"merge","moduleId":"module-example-id","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","baseHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","requestKey":"reviewed-update-1"}
```

同一请求的不确定回执使用相同 `requestKey` 查询；不能用同一键换参数。active 已变化、选中 commit 与 upstream ref 不符、合并冲突或没有共同历史时会拒绝，不自动 reset、stash、覆盖或激活。未确认提交的失败操作先检查已有候选和诊断，再决定是否用新键重试。

发行 catalog 的 `git.repository: null` 明确表示未发布的本地来源。bundle 可用于离线安装，不意味着 GitHub 仓库已存在或在线 fetch 可用；没有已登记 repository 时不会冒称可以联网更新。

## 离线更新与旧版本

`modules.install` 仍只接受官方 external package 名称、`mode` 和 `requestKey`。首次 `mode: "install"` 从可信 bundle 的精确 commit 安装；已有外部应用的显式 `mode: "update"` 将离线发行候选交给相同的 Git merge / propose / 检查流程，不用发行快照直接覆盖本地定制。五个 builtin 不能通过 install 重装，使用上面的定制及显式上游流程。

新安装、提交、导入及上游操作需要可执行的系统 Git。Git 缺失时明确失败；已有 store 中的受检版本与仍有匹配可信资源的 legacy 内置运行不要求先完成源码 Git 导入。启动登记也不会为了跟进新发行而 fetch 或覆盖当前版本。

旧 64 位记录只有在原有源码能按原摘要规则验证时才可导入 Git；原 hash、审批和 active 身份保持不变。旧内置可能没有 store 源码，源码读取须核对原 hash 对应的可信发行资源。失源或摘要不匹配需要明确诊断，不能取当前新发行或 upstream 冒充旧历史；缺失旧源码也不能被描述为已经迁移成功。

Git 和 `modules.rollback` 的代码版本切换不等于恢复应用数据。数据 schema、快照恢复、审批及日程兼容继续由现有生命周期检查，不能用代码回滚承诺撤销数据变化。备份应保留整个数据目录中的源码仓库、运行产物和应用数据，详见[运维说明](operations.md)。

当前实现的自动化检查使用临时仓库、临时数据库和受控测试进程；不据此宣称所有平台打包、真实账号、公开上游、安装部署或真实数据升级已通过验收。
