# Author 通用版本材料与运行产物

状态：实施、隔离验收与全新数据部署完成。用户明确授权备份并删除旧活动数据；3112 已运行新版本，没有执行旧数据升级迁移，也没有重试真实播放器请求。

## 开发与材料交接

当前对话 Agent 使用已有工作区和文件、命令工具开发、安装开发依赖、编译与测试；这些动作仍受该 Run 的授权、预算和停止机制约束。Author 不拥有编译器，不增加分语言构建工具，也不另启 Agent 或执行队列。

Author 导入明确选定的源码和运行产物，计算文件摘要，形成完整版本材料。源码包含后续修改所需的源文件、依赖锁、构建脚本、资源与 `.gitignore`。`.gitignore` 是开发文件，不是发布清单；被它忽略的二进制仍可明确选为运行产物。

源码存入现有模块 Git 历史。运行产物独立保存在不可变、按内容摘要寻址的存储中。Git 内的版本材料记录绑定产物路径、摘要与执行属性，因此运行文件变更也会改变该版本的源码提交。Web 自身的发行材料也采用此方式：生成的 `pages.js`、`style.css` 作为运行产物，完整前端源码、锁文件、构建脚本及材料记录留在 Git，离线安装校验并恢复相同字节。基础样式单独保存在 `src/base.css`，构建脚本不依赖仓库外的契约文件；隔离源码克隆可用离线依赖重建两份产物并核对摘要。源码与产物同时存在、构建记录被保存，都不证明产物已独立重建验证。

## 版本记录

提交目录中的 `chrona-material.json`：

```json
{
  "schema": 1,
  "source": ["module.json", "src/main.c", "build.sh", ".gitignore", "test.ts"],
  "artifacts": [
    {"path": "bin/player", "sha256": "<实际文件的 SHA-256>", "executable": true}
  ],
  "build": {
    "commands": ["./build.sh"],
    "toolchain": "由构建者记录的编译器及版本",
    "target": "linux-x64"
  }
}
```

记录本身随源码保存，不在 `source` 中重复列出。源码和产物路径互斥；源文件与运行文件相同的解释型项目可以只在源码中保留一次。没有记录的既有解释型应用继续使用原来的材料检查路径。

提交先固定完整材料，再暴露给候选检查。实际检查、安装、回滚与导出都取回精确版本的运行材料，校验摘要并恢复声明的执行权限。旧版本恢复不依赖临时重新编译；缺失或损坏的产物直接失败，不能换用最新构建结果。

## 导入、导出与限制

`author.import` 接受 `{input: JSON.stringify({from,to,source,artifacts,build})}`。`from` 是明确的绝对工作目录；`to` 是全新的 `sources/<workspace>`。`source` 显式列出源码路径；`artifacts` 列出 `{path,executable?}`，Author 读取实际字节并计算 SHA-256，执行标记须与工作文件一致。返回 `{path,record,files,bytes,materialDigest}`。

`author.export` 接受 `{input: JSON.stringify({path,to})}`，从 Author 源码目录或阶段材料导出到全新的绝对目录，返回 `{path,to,files,bytes,materialDigest}`。旧版本先通过已获准的 `author.source` 取回精确版本，再导出；不会自动选择最新版本或覆盖工作目录。

显式材料最多 199 个源码文件，加一份记录共 200 个，字节总和不超过 1 MiB；最多 1000 个产物，每个最多 64 MiB、合计最多 256 MiB。文本 `author.write/read` 保留 64 KiB 单文件限制；大源码和二进制使用导入/导出。开发目录如 `.cargo` 可明确选入，`.git`、路径穿越、链接及特殊文件被拒绝。安装依赖目录 `node_modules/.venv/.chrona` 不属于提交材料。

快照会在读取结束时重核所选文件和祖先目录，防止混合版本。检查后和实际启动前验证完整安装树及摘要；允许依赖安装目录，拒绝未声明的额外程序文件。缺失的已批准版本目录先在私有目录重建材料和锁定依赖，校验完成后再以不覆盖方式原子发布；已有损坏目录保留并拒绝启动。制品完整写入私有临时对象后原子发布，已有损坏对象保留并拒绝使用。当前原子不覆盖发布依赖 Linux `renameat2(RENAME_NOREPLACE)`；不支持该机制的宿主会失败，未验证其他平台。

## 启动契约

既有脚本 `entry: "index.ts"` 保留。新增对象形式：

```json
{"entry": {"path": "bin/player", "args": []}}
```

直接运行模块内的固定文件。需要宿主解释器时显式声明：

```json
{"entry": {"path": "dist/player.jar", "runtime": "java", "args": ["-jar"]}}
```

解释器必须已在宿主提供。命令按程序与字面参数启动，不经 shell 字符串展开。运行进程继续使用原有认证 IPC、环境处理、后代进程监督、取消和实际停止证据。声明启动方式不等于实现了 SDK 协议，应用仍需通过真实启动与协议检查。

## 后续修改与权限

当前真实入口为已批准的 Author 身份、完整目标集合及准确活动基线申请固定 admission。Author 获取准确基线、导出到新工作目录；Agent 修改源码、重建产物后再导入提交。提交不表示检查通过或激活；不确定响应使用原请求键和固定回执核对。

候选材料的真实调用者、目标和基线校验、既有数据保护、审批、凭据及实际停止规则保持有效。没有新增公共内核工具或语言专用编译服务。

## Web 组件指导

入口 Agent 的指导同步补充：普通应用调用 `web.component-set` 注册可信 JavaScript/CSS，在 `web.page-set` 中引用 `app:ComponentName`；应用在自己的 activated 生命周期中注册，以绑定实际身份和活动版本。组件直接在 Web 同页执行，不承诺 iframe 或沙箱隔离；回调保留页面与工具契约校验，卸载时释放媒体、文件 URL 和监听器。

## 验证

源码集中回归：`bun scripts/run-bun-tests.ts` 指定 15 个文件，125 通过、0 失败、0 跳过，涵盖真实 Agent 原调用者 → Author SDK → 候选检查/审批/安装 → 精确旧版本导出与再编辑、Git/CAS 分离、摘要损坏拒绝、原生和解释器启动。证据：`/tmp/chrona-version-materials-focused-final.log`。原生进程认证、字面参数和后代停止由宿主适配器测试验证；没有声称任意语言程序自动具备 SDK 协议。

最终补充恢复回归 16 通过；相邻产物 28 与源码 4 通过，共 48 通过、0 失败，部分与集中回归重叠，不相加。覆盖锁定依赖先于实际启动、失败后无最终半成品、并发不覆盖、已有损坏目录保留。最终完整证据：`/tmp/chrona-version-materials-recovery-complete.log`，`RECOVERY_EXIT=0`。

根 TypeScript 与 `LINT_RATCHET_BASE=HEAD bun run lint` 通过；依赖方向检查 0 错误、40 个既有警告，没有放宽规则。构建资源与离线 Git 测试共 12 通过，其中 Web 源码独立克隆、离线安装依赖、重建产物并逐摘要核对已通过。API 官方完整运行 19 文件、104 通过、0 失败。浏览器组件最终验收 45/45 通过、源码漂移为空，三种视口实际选择本地 WAV 并播放/暂停，使用真实页面实现及有限清单夹具，不是已安装播放器或真实模型验收。

日志分别为 `/tmp/chrona-version-materials-typecheck-complete.log`、`/tmp/chrona-version-materials-lint-complete.log`、`/tmp/chrona-version-materials-boundaries-final.log`、`/tmp/chrona-version-materials-packaging-tests-final.log`、`/tmp/chrona-version-materials-api-final.log`；浏览器报告为 `.tmp/web-executable-components/runs/2026-11-09T14-10-35.668Z/report.json`。

## 发布材料与全新安装验收

Linux x64 二进制：`dist/releases/chrona-linux-x64/chrona`；SHA-256：`90692e552f79e0ee7a9a634f3626fb233348e3e6668a105b8fd8f20e9d8ae5d7`。

配置中的 14 个模块离线源码克隆均校验通过。追踪资源仅更新 Author、Web、MCP、QQ 的 bundle 与元数据条目，其余 10 项保持原追踪内容；完整二进制使用隔离生成、与各自源码一致的全套离线材料构建。

| 应用 | 当前离线源码提交 |
| --- | --- |
| Author | `0213d1c839450a1f465893e12941fe9e653194f3` |
| Web | `16034e497bd7437c0fa5937f4f7a43ef38071f3b` |
| MCP | `82943ef2bd4d7efe435b43433fb59d57f90a8d41` |
| QQ | `4c7d8d6cf34b5ca1b5ac186fcdecf4d43ea188e0` |

实际二进制在全新临时数据库、私有依赖缓存和禁止网络的安装器包装下完成安装与候选检查；需要批准的候选按精确身份/哈希批准，再核对活动版本及真实调用能力。按需应用可处于正常 idle 状态；Author 根目录读取和 Coding 项目列表读取用于观察实际工具能力，不把进程存活直接当作业务验收。

最终 `/tmp/chrona-version-materials-smoke.log` 为 `SMOKE_EXIT=0`：Author 十个工具及纯 prepare、源码/二进制导入暂存导出、摘要/私有权限/执行属性、已安装 Web 组件契约及调用方可见性、Mind 默认关闭与重启持久性、设置页实际读取、Coding HTTP/模块共用会话、真实项目宿主、重复回执与参数冲突均通过。Run 行数与实际模型请求均为 0，临时数据目录和测试子进程已清理。

验收边界：发布包验证了对象 entry 的 Author 材料往返；该 smoke 没有另行安装一个原生 SDK 模块。内核候选安装往返由实际 SDK 集成回归证明，原生/解释器认证 IPC、字面 argv 和停止边界由宿主进程测试证明。构建记录本身不证明独立可重复构建，Web 的源码独立重建另有专门测试。未执行现有数据部署、真实模型验收、真实播放器重试、提交或推送。


## 2026-11-09 现有环境部署阻塞与回滚

首次向现有 3112 环境的更新尝试在停止服务后的安装阶段失败，当时已恢复完整停机备份并重启旧版本。以下记录描述该次阻塞；后续已按用户授权清空活动数据并完成全新部署，见下一节。首次回滚保留了原数据、配置与应用身份，没有模型请求，也没有重试 player。

发布包包含合并代码带入的 `0002_s5_kernel_execution` 迁移，而现有数据库仅应用 `0001_initial`。新程序在安装器读取 Module 时要求 `activationId`，现有表没有该列。该迁移明确仅面向全新数据，直接向非空 Module 添加无默认值的 NOT NULL 列；在现有数据库的内存副本上执行会报 `Cannot add a NOT NULL column with default value NULL`。不能直接运行该迁移来升级现有环境。它还调整 ModuleCall 并删除四张旧执行器表；本次只读核对四表均为 0 行，未实际执行删除。

现有环境为 10 个应用身份、4 条历史 Run。回滚后实际运行二进制 SHA-256 为 `d69c49813123a8a102164537b994ea61f60787a2de4bf876db0d3e6ace2038a2`，健康检查及 Pi 可用性正常，服务环境字节不变，3111 仍停止。完整备份位于 `.tmp/kernel-minimization/local-deploy/rollback-author-materials-20261109T150201Z`；结构化核对位于 `.tmp/author-version-materials/deployment-blocked.json`，部署日志为 `/tmp/chrona-author-materials-deploy.log`。

保留原数据的升级路径没有实施。原更新脚本增加已应用迁移与发布包迁移集合校验，阻止再次尝试未经验证的升级；用户随后明确选择备份并删除旧活动数据，使用全新数据库部署。


## 2026-11-09 全新数据部署完成

用户明确授权“直接备份并删除旧数据，不用升级迁移”。服务停机后复制完整活动数据，逐文件核对大小与 SHA-256（共 28168 项），验证成功后删除原活动数据目录内容，再由新版本创建全新数据库。没有导入旧会话、旧播放器候选、旧应用身份或业务设置。服务密钥、环境文件和外部 Pi 配置保留不变。

- 服务：`chrona-kernel-preview.service`，监听 `127.0.0.1:3112`；3111 保持停止。
- 运行二进制 SHA-256：`90692e552f79e0ee7a9a634f3626fb233348e3e6668a105b8fd8f20e9d8ae5d7`，已核对 `/proc/<pid>/exe`。
- 完整旧数据备份及旧发行包：`.tmp/kernel-minimization/local-deploy/rollback-author-materials-fresh-20261109T151130Z`。
- 结构化部署记录：`.tmp/author-version-materials/local-deployment.json`；日志：`/tmp/chrona-author-materials-fresh-deploy.log`。
- 新库已应用 `0001_initial`、`0002_s5_kernel_execution`，完整性和外键检查通过。

Agent、Web、Notify、QQ、Author、Coding、coding-web、MCP、Mind 共九个应用已按本次发行包完成候选检查、必要的精确版本批准与激活核对。Author prepare 纯读取及导入/导出工具、已批准 Web 自定义组件契约与模块调用方可见性、实际前端资源字节、六个设置页、Coding 读取、MCP 24 工具、内核五命名空间 32 工具及未认证拒绝检查通过。Mind 自动处理与通知保持默认关闭。Pi 健康检查可用，模型配置保留。

部署脚本第一次全新部署在收尾检查中误经普通工具调用接口访问 `modules.tools`，导致自动恢复旧备份；修正为既有 Web 工具发现路由及批准清单检查后，重新执行备份、清空、安装和完整收尾检查成功。该修正仅涉及部署验证脚本。

最终 Run 行数为 0，没有发起模型请求，没有重试真实播放器，也没有提交或推送代码。这里的在线检查确认部署与读取能力，不替代先前隔离测试，也不声称已经实际安装并运行一个播放器或原生 SDK 应用。
