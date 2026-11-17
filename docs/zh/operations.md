# Chrona 运维说明

适用于重构后的单一 owner 版本。先读[快速开始与配置表](../../README.zh.md)。所有命令均在仓库根目录执行，或使用对应版本的打包 CLI；不要用旧版本可执行文件操作新库。

## 模块远端仓库

模块远端关联和显式推送由本机所有者 CLI 执行：`chrona admin git-associate`、`git-status` 和 `git-push`。写操作先停止使用同一数据目录的服务；推送需要明确的源码提交和预期远端提交，不随启动或激活自动执行。参见[模块源码与 Git 工作流](module-git.md)。实例备份应同时保留数据库中的来源登记和 `platform/repos` 中的 Git 历史与配置。

## 网页登录密码

网页支持设置和修改独立的登录密码。首次打开时，尚未配置密码会显示设置表单；设置后使用密码登录，在「设置 → 登录密码」中输入当前密码和新密码即可修改。密码至少 10 个字符，最多 256 个字符；空格属于密码的一部分。

已有实例配置了 `API_KEY` 时，首次设置须使用原有访问授权。已保存访问密钥的浏览器可直接设置；换浏览器时可在首次设置表单输入原访问密钥，设置完成后浏览器会移除该密钥。未配置 `API_KEY` 的新实例只允许通过服务端确认的本机回环连接首次设置，转发头不能代替本机连接身份。

密码验证由 HTTP 服务负责，Web 应用只提供表单。服务端仅保存密码哈希与会话令牌的哈希；浏览器通过 HttpOnly、SameSite=Strict 的 cookie 保持登录，不在 localStorage 保存密码。退出登录会撤销当前会话；修改密码会撤销原有会话，并为当前浏览器签发新会话。登录会话最长 30 天，过期后重新输入密码。

`API_KEY` 仍用于已有程序客户端；救援入口继续使用独立的 `RESCUE_KEY`。网页密码修改不会改写这两个环境变量。

## 新版 API 开发边界（2026-11-10）

公开合同见[API 规范](kernel-api-design.md)，工程验证见[实施记录](kernel-api-implementation.md)。这次改造只面向全新数据目录，既有数据库继续受迁移 checksum 拒绝守卫保护；不要覆盖旧服务的数据或将旧部署验收用于新版。

新增 `authority: "owner"` 的应用检查通过后仍须批准精确版本，包括 Web、QQ、MCP；预装不是审批例外。Web 尚未启用时，使用已有的认证救援页处理审批。只看到 building、pending_approval 或连接成功，都不表示入口与业务已可用。

## 当前发行与默认应用（2026-11-13）

全新数据目录默认初始化 Pi、Web、Notify、Author、Mind、Chat 六个普通应用；QQ 是随包提供、需显式安装的可选应用。发行的源码树与 Git 种子只包含这七个应用；MCP、Files、Events、memory-local、Remind、remote-execution 等保留源码不进入本轮发行。Coding 与 coding-web（含 work-v2）已退役移除，当前 Chat 独立拥有会话与执行记录，见[Coding 退役说明](coding-retirement.md)。旧目录条目缺少发行资源时报告不可用，不因启动恢复暂停或退役应用。

初始化保留已有选择，应用移除后启动不自动补装；重新安装走显式生命周期检查。构建只裁剪 staging 资源，不删除仓库中的保留源码。源码与定向测试结果不代表种子已同步、真实远端已核验或新版本已部署；这些结果分别记录。

## 此前应用状态（2026-11-09，仅作运维背景）

Agent 是唯一不可变内置应用；Web、Notify、QQ、Author 是普通默认预装应用。当时 Coding 是无界面的普通可选服务，coding-web 是独立可选客户端；两者现已退役，旧协议和实施记录从 Git 历史查阅，见[Coding 退役说明](coding-retirement.md)。旧 Editor 应用及安装入口已退役移除，见[退役记录](editor-retirement.md)。Remind 整应用暂停并保留源码；Mind 是普通可选应用，自动检查与通知默认关闭；memory-local 仅暂停定时整理。Editor 清理没有更新现有 3112 部署，下方历史升级和验收不证明清理版本已经部署。

## 历史最小内核与本地升级（2026-11-08）

若已批准应用源码与本机发行 tree 完全相同，但经 Author 提交后 commit 不同，可在停服后显式运行 `chrona admin install pi --update --exact-release --request-key <唯一键>`。该选择仅接受真实发行 lock/bundle 固定 commit，并复核当前已批准身份与源码全等，再走正常构建、测试及审批激活；旧 Git 历史保留。存在不同源码定制时拒绝，普通 `--update` 仍按 merge 处理。`building` 是候选入队，完成后用原 key 核对 `installed`；身份变化需重新审视并使用新 key。

升级前后先运行 chrona doctor：它会报出迁移基线不兼容、Pi 版本与补全能力、以及需要 admin install --update 的外置应用。

本节保留当时升级边界；应用类别、编码协议和安装支持以本页上方当前状态及永久内核合同为准。

固定内置为 `agent/web/notify`。`mcp/files/events` 已转为可选官方外置应用；保留已有身份、批准版本及私有数据，删除后启动不补装。Agent 不允许动态替换。当前开发仅面向本地，不以 chino 数据副本作为门禁；真实旧数据删除仍须单独确认。

- Web 不可用时使用不可变救援页：审批、暂停或恢复应用、回滚已批准版本；恢复按钮调用 `POST /api/modules/:id/resume`（请求体 `{}`，使用 `RESCUE_KEY` 认证），也适用于连续失败后自动暂停的应用；没有聊天入口。
- 离线恢复先停止服务，再运行 `chrona admin enable <module>`（与 `chrona admin disable <module>` 使用同一数据库运行锁）；完成后重启 Chrona。
- MCP 已删除时，停服后运行 `chrona admin catalog`，再用 `chrona admin install mcp --request-key <唯一键>`。这只是受理受检构建，不代表已安装完成；未知回执用原 key 查询，失败重试须明确使用新 key。
- 全局 `history/content/memory`、`projects.default` 已删除。附件由所属应用读取；记忆和偏好由应用自己保存；默认项目由 Coding 选择，宿主只提供有界 `projects.create`。
- OAuth 清单必须声明 HTTPS 授权/令牌端点。改变定义需要审批；没有定义绑定的旧凭据须重新授权，不能把旧 refresh token 自动发给新端点。
- `agent-workbench.nvim` 本轮未修改，旧客户端依赖的 `content.read` 不再可用。Chrona 提供 `coding.read-result`，但不能据此声称旧客户端成果界面已兼容。

### 当前存储与旧数据边界

当前源码已删除 `admin legacy` 及旧 kernel 消息、Grant、构建会话存储；旧版本的归档工具只能从对应发行或 Git 历史取用。`Timer` 只保存应用定时唤醒，暂停应用保留定时器，投递仍核对当前版本与生命周期。

本轮初始 schema 默认用于全新开发数据。旧库继续由 migration checksum 守卫拒绝；一次性[离线转换工具](../../scripts/one-off/storage-20261116/README.md)仅放在仓库中，不随程序打包，也不会自动操作真实数据。它从停服旧目录生成独立的新目录与转换前完整备份，不替换源数据。Mind 改用单个 `mind.sqlite`，入口会话改用 `conversations/sessions.sqlite`；发现旧存储且新库不存在时明确拒绝启动，避免静默显示空数据。实际转换、版本切换和恢复验收另行授权。

普通应用同步工具显式声明 `readOnly: true` 后，无 key 的读取不保存调用与执行历史；有 key 的读取保留精确回执。声明模型预算的应用保留预算需要的最小事件行，省略只读结果正文。故障、恢复转换、审批、未知效果与异步交付继续保留其实际消费者需要的事实。

每小时清理七天以上的已结算诊断记录，每表每次最多 40 批、每批 500 行。已确认停止且交付结清的 Run 在 90 天后清空 prompt、summary、error、toolCalls；已完成应用调用的请求/结果正文同期过期，保留 key、请求摘要及目标绑定，原 key 返回过期冲突，不能重新执行旧动作。未知结果、未确认停止、未交付回复和待审批调用不按年龄清理。系统生命周期回执、Agent completion 回执和当前 activation 的去重事实仍保留；这不是整个数据库容量的硬上限。

备份先取得服务运行锁；Linux 还拒绝 cwd 位于 platform/sessions 数据树下的遗留进程。私有 SQLite（platform/data 下 `.db/.sqlite/.sqlite3`）通过 `VACUUM INTO` 和 `quick_check` 归档包含已提交 WAL 页的快照。cwd 检查不覆盖已经换目录的任意进程；进程停止证据仍须结合服务及 process guardian 核对。自动测试只操作全新临时数据。

## M1 历史开发集成边界（2026-11-05）

当前开发契约见 [P0 契约](chrona-workbench-p0-contract.md)。官方外置资源已移至 external；发行包需同时含 resources/builtin 与 resources/external，缺发行资源不得回退源码。`chrona admin catalog` 只读目录，`admin install <package> --request-key <key> [--update]` 在停服锁下仅持久受理/入队；运行时与停服 admin 共用真实官方安装适配器，不启动额外 Provider；受理后由原受检构建流水线处理。未配置适配器时返回 unavailable，收到 building/pending 不代表安装完成。失败重试要明确新 key；未知回执复用原 key 查询；初始化完成后不补装已删预装。只用全新开发数据目录，旧生产转换、迁移与部署另行授权。开发完整套件、三尺寸浏览器与 Linux x64 发行验证已完成，协调者已签署 M1 开发验收；精确树、归档散列与未覆盖环境见 M1 验收记录（已从工作树删除，见 git 历史 docs/zh/chrona-workbench-m1-acceptance.md）。当时的内置划分已被上方最小内核划分取代；该节仅保留历史验收边界。

## M2 历史编码开发集成边界

当时可选官方外置 `coding`、`editor` 的项目映射、owner 身份、成果与停止未知恢复见服务器编码工作（已从工作树删除，见 git 历史 docs/zh/server-coding.md）。当时单服务器编码、真实 fake Pi/Neovim 目标联调已通过；完整集成检查状态见M2 验收记录（已从工作树删除，见 git 历史 docs/zh/chrona-workbench-m2-acceptance.md）。M3 在该阶段尚未实现；此记录不作为当前安装或部署说明。不得将旧 loopback Provider bridge 暴露到外网。

## 启动与数据位置

源码开发用 `bun run dev`（Hono watch 模式），不使用 watch 模式时用 `bun run server:start`；两者默认在 `127.0.0.1:3101` 提供内置 web 模块和 API，不另启 Vite 服务。打包版本用 `chrona start --no-open`，默认同样监听 `127.0.0.1:3101`；`chrona start` 只在打包版本提供。

建议在启动、备份、恢复与诊断的同一环境中显式设置：

```bash
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
```

以上目录必须是新目录或已经属于本版本的数据目录。源码服务不根据 `CHRONA_DATA_DIR` 推导数据库，未设 `DATABASE_URL` 时默认使用 `file:./prisma/dev.db`。打包 CLI 的备份、恢复、诊断默认使用数据目录内的 `chrona.db`。显式设置两者可避免操作错库。

打包 CLI 数据目录未指定时：Linux 使用 `XDG_DATA_HOME/chrona`，否则 `~/.local/share/chrona`；macOS 使用 `~/Library/Application Support/chrona`；Windows 使用 `APPDATA/chrona`，否则用户目录下的 `AppData/Roaming/chrona`。

启动自动应用迁移、创建 `ws_default` 工作区并获取数据库运行锁。不要启动两个服务共享同一个数据库。

## 从空目录开始

迁移运行器拒绝重构前的数据库，也拒绝已应用迁移的校验和变化。这不是自动升级旧数据的路径。

1. 停止旧服务，确认不再有写入。
2. 归档旧数据库、SQLite 附属文件和相关状态，保留可恢复副本；不要删除或覆盖原件。
3. 选择全新空目录，设置新的 `CHRONA_DATA_DIR` 与 `DATABASE_URL`。
4. 启动新服务，确认页面与诊断指向新库。

真实数据归档、切换与恢复应由 owner 明确批准。不要修改迁移记录来绕过拒绝，也不要把旧库恢复到新服务期待的位置。

## 阶段化部署预检与验收

主仓库提供三个本地入口，组合现有 backup、release identity 和 packaged smoke；它们不连接 chino、不调用 SSH/systemd/NixOS，也不替换服务：

```bash
bun run deployment:preflight -- \
  --release-dir /absolute/path/to/dist/releases/chrona-linux-x64 \
  --data-dir /absolute/path/to/chrona-data \
  --database-url file:/absolute/path/to/chrona-data/chrona.db \
  --pid <actual-chrona-pid> \
  --active-resource-root /absolute/path/to/current/resources \
  --report /absolute/private/path/preflight.json
bun run deployment:backup -- \
  --database-url file:/absolute/path/to/chrona-data/chrona.db \
  --data-dir /absolute/path/to/chrona-data \
  --output /absolute/private/path/before.db
bun run deployment:accept -- \
  --release-dir /absolute/path/to/dist/releases/chrona-linux-x64 \
  --target linux-x64
```

`preflight` 只读核对候选发行组合、真实进程 resource root、指定数据库的迁移 checksum、实际 `Module.activeHash`、未知停止和未结算 Run/调用/交付。它要求指定数据库的运行锁由 `--pid` 持有，因此数据库可以位于 `dataDir` 外；缺少必需状态表、未知停止、未结算工作、待回调、未接受的 outbound receipt、未确认停止或未清理 workspace 均输出 `passed: false` 并以非零退出。active hash 差异只列为受控激活输入。

资源根复用启动器 `findResourceDir` 的优先级，以目标 `/proc` 的 cwd、cmdline、exe 和环境为输入；支持显式 `CHRONA_RESOURCE_DIR`（相对目标 cwd）、启动二进制邻接资源、显式 `CHRONA_PACKAGE_DIR`，以及可确定的 `packages/cli/src/bun-entry.ts` 源码入口。隐藏在其他 wrapper 内的 package fallback 若无法观察，会报告具体原因；启动器原有 fallback 保留。预检不是进程排空或停止证据，结果只描述检查时刻。

`deployment:backup` 复用 `chrona backup` 的完整快照，包含 SQLite、`platform`、`sessions`、`secrets` 和 `qq-bot`，并在全新临时目录调用既有 restore 做可读性验证。失败的部分文件不可当作成功备份，重试必须使用新的输出路径。

构建归档的复制和正式切换由现有受控运维流程负责：

1. 使用既有 builder 产出的归档；在全新临时目录解包后，对归档内实际 `chrona-<target>` 目录运行上述 `deployment:accept`。这样 identity、字节、模式、CLI 和资源检查针对实际归档内容；SHA256 仅用于传输前后字节核对，不证明来源授权。
2. 对同一实例配置执行运行中 preflight；得到本次具体切换授权后排空、停服，观察服务及应用进程实际退出，再以同一 `--database-url`/`--data-dir` 执行 backup，另行归档 Provider profile 等自定义目录。备份的运行锁和 cwd 检查拒绝仍存活的运行者。
3. 在现有部署目标中切换已核验组合，记录启动后的实际进程、资源根、数据库和应用 active hash，再做本次业务验收。真实切换、恢复、回滚和 NixOS 激活分别受具体任务授权约束。

阶段 8 不生成 `delivery.json`，也不把本地文件复制称为部署。`deployment:accept` 只验证 target 对应标准发行目录的实际制品，改名目录和同级其他 target 目录会明确拒绝。

## 备份与恢复

先停止服务（完整备份会获取数据库运行锁，服务运行时拒绝操作），确认 `CHRONA_DATA_DIR` 与 `DATABASE_URL` 指向同一实例。归档和恢复在进程内处理，不依赖系统 `tar` 或 Shell。

```bash
chrona backup /absolute/private/path/chrona-backup.db
chrona doctor
```

备份生成一对文件：`chrona-backup.db`（一致性 SQLite 副本）和 `chrona-backup.db.tar`（`<dataDir>/platform`、`sessions`、`secrets` 和 `qq-bot`）。即使数据库放在数据目录外，也以显式 `CHRONA_DATA_DIR` 选择文件根目录。两者缺一不可，均未加密；tar 和数据库文件权限为 0600，备份目录也应仅 owner 可访问。缺失的数据目录按空目录恢复。`secrets`、`qq-bot` 中的符号链接和特殊文件会使备份失败；`platform`、`sessions` 中的则不进入归档，并在命令输出中列出（它们指向数据目录外，或可重新生成，如依赖安装的 `.bin`）。模块和会话中安装的依赖目录（`node_modules`、`.venv`）与会话里的浏览器临时配置（`.chrome-*`）不备份；使用 portable ustar，超出该格式路径/文件大小限制会失败。命令失败时可能留下不完整副本，不要将其当成成功备份；重试使用新输出路径。

不要用运行中的裸数据库复制代替一致性备份。Provider profile（默认 `<dataDir>/providers/pi`，包含其自身认证）及其他自定义目录不在此 tar 中，需单独安全归档。不要公开或将认证写入版本库。

恢复前停止服务，确认目标数据库路径，保留现有数据备份：

```bash
chrona restore /absolute/private/path/chrona-backup.db
```

恢复必须同时提供数据库和同名 `.tar`，不会静默退回仅恢复数据库。默认不覆盖已有数据库或数据目录；`--force` 替换而非合并目录，避免留下旧文件。恢复拒绝不安全路径、链接及非本命令生成的归档格式。只恢复可信来源的备份。

旧数据库恢复副本保留在数据库旁，旧数据目录保留为数据目录下 `.restore-files-*-prior-platform` / `-prior-sessions` / `-prior-secrets` / `-prior-qq-bot`。普通错误会回滚目录；跨 SQLite 与文件目录的替换不是崩溃原子事务。断电或强制中断后，不要直接重启：保留整个目录，请 owner 检查数据库恢复标记及暂存/旧目录，或在全新目标目录用完整备份对重试。大归档恢复会占用与归档大小相关的内存。

只有明确要替换且已有恢复手段时才使用 `chrona restore /absolute/private/path/chrona-backup.db --force`。恢复后运行 `chrona doctor`，再启动服务并检查页面。建议先在独立目录演练恢复，不要首次在真实数据上试验。

源码环境将上述 `chrona` 替换为 `bun run packages/cli/src/index.ts`，例如：

```bash
bun run packages/cli/src/index.ts doctor
```

`doctor` 检查 Git、执行模式配置、数据库存在性、SQLite 完整性、存储权限、运行锁和网络安全配置。旧隔离配置会产生 `executionMode` 错误并使命令非零退出，附移除说明；它不探测 bubblewrap，也不全局要求 Shell、Nix、Python、浏览器或外部 `tar`。模块按自身声明检查所需程序；doctor 不替代模块安装检查，也不验证模型或 QQ 能否真正响应。确认进程已退出后，才考虑 `chrona doctor --repair-stale-lock`；它隔离确认陈旧的锁，不删除数据库。畸形锁需人工检查。

## 环境变量

源码环境样例见 [`.env.example`](../../.env.example)；当前运行配置以下列说明为准：

- 存储：`DATABASE_URL`、`CHRONA_DATA_DIR`；迁移路径覆盖为 `CHRONA_MIGRATIONS_DIR`。
- API：`HOST`、`PORT`、`API_KEY`、`ALLOWED_ORIGINS`。保持回环监听；不得靠危险覆盖项替代认证。
- Provider：`CHRONA_STEWARD_AGENT=pi`、`CHRONA_STEWARD_PI_COMMAND`（必填绝对路径）、`CHRONA_STEWARD_PI_VERSION`（默认精确 `0.85.0`，可显式选 `1.3.0` 及以后的 `1.x`）、`CHRONA_STEWARD_PI_AGENT_DIR`（默认 `<dataDir>/providers/pi`）、`CHRONA_STEWARD_PI_RESOURCES_FILE`（可选受控资源清单）、`CHRONA_STEWARD_PI_MODEL`、`CHRONA_STEWARD_PI_WEB_EXTENSION`；Chrona 工具扩展由运行时选择。应用的有界模型调用（补全）只在精确 1.5.0 上可用；其他版本上健康检查报告不可用，日志事件 pi-completion completion_failed / pi completion_unavailable 给出原因。
- 后台：`CHRONA_STEWARD_TICK_SECONDS` 默认 30 秒；没有接待 / assessor 双角色。
- 本地执行：`CHRONA_STEWARD_EXECUTION_MODE` 未设置、空值或 `trusted-local` 均为可信本地执行。`required-isolation` 和其他非空值报错；非空 `CHRONA_STEWARD_SANDBOX_BWRAP` 也报错，须从启动环境和配置文件移除，不能沿用旧隔离配置。
- 模块依赖：manifest 的 `packages` 是宿主已安装、Chrona 进程 `PATH` 可找到的程序名，缺失时报告并请用户安装后重新提交；不再通过 Nix 自动供应，`CHRONA_NIXPKGS` 不再是模块运行配置。语言库按 `bun.lock` / `uv.lock` 安装；npm 依赖使用宿主 Bun 的冻结安装并禁用安装脚本，Python 依赖需要宿主 `uv` 和 `python3` / `python`，执行 `uv sync --frozen --python <宿主解释器> --no-python-downloads`。语言库安装仍需 npm / PyPI 或本机缓存。
- 浏览器：`CHRONA_STEWARD_BROWSER` 可指定已安装的 Chromium 兼容可执行文件；也会在 `PATH` 查找已安装浏览器。不自动下载或通过 Nix 获取浏览器；缺失只影响网页工具，不使其他本地能力失效。
- QQ：由官方预装外置 `qq` 模块提供。`CHRONA_QQ_APP_ID` 与 `CHRONA_QQ_SECRET_FILE`（私有文件）由内核保存，模块经声明的 `secrets.get` 按需读取；链接用 `CHRONA_PUBLIC_URL`。`CHRONA_QQ_STATE_DIR` 只在首次升级时用于迁移旧绑定。
- Owner MCP：`/api/mcp`（Streamable HTTP，无状态，`Authorization: Bearer <API_KEY>`）由内置 `mcp` 模块提供，供用户自己的 Pi / Claude Code 使用。工具与网页 owner 操作相同：`chrona_today`、`chrona_apps`、`chrona_sessions` 等会话工具、`chrona_chat`、`chrona_approvals`、`chrona_approval_resolve`、`chrona_modules`、`chrona_notifications`；通过 `chrona_module_tools` 发现 owner 可用的模块工具，再用 `chrona_module_call` 调用，不直接暴露 Provider 的 `m_*` 工具。客户端应对 `chrona_approval_resolve` 要求逐次确认。

本机回环监听时只接受 Host 为 localhost、回环 IP、CHRONA_PUBLIC_URL 或 ALLOWED_ORIGINS 中的主机名；同机反向代理需把公开域名写进 CHRONA_PUBLIC_URL。

环境变量修改后重启服务。保持 `CHRONA_E2E_TEST_ROUTES` 未设置。开发脚本默认回环监听；修改 `HOST` 对外开放前须配置认证。

## 停止与中断恢复

正常停止先关闭 HTTP 接单和 tick，再等待已启动的 Provider、构建、日程投递及最终记录收尾，最后关闭模块与数据库。30 秒仍未收尾则以非零状态退出，按异常中断处理，不把它报告为正常停止。日程的投递记录与到期推进一起持久化：明确未送达最多退避重试六次；投递中的服务中断在租约过期后标为结果未知并通知用户，不重放可能已经产生的外部效果。到期后仍未送出的提醒可取消。

普通 Agent 连续失败三次后停止自动续跑；Provider 配置不可用或应用调用结果未知时立即停止自动续跑，用户查看原因、核对结果后再继续。每日预算仍独立生效。构建维持不自动重试。

## 日志与健康

日志输出到服务标准输出/错误；由运行终端或进程管理器收集，没有统一固定日志文件路径。注意启动失败、迁移拒绝和 `STEWARD_TICK_FAILED`。`qq` 模块的 `qq-bot` 事件写在模块的标准错误里，Chrona 只保留最近 16 KiB 用于失败记录。分享日志前检查是否含私人文本或路径，不要附上密钥、绑定文件或数据库。

- **设置 → 运行状况**：Agent、来源积压、发件箱等应用级状态。
- API 端口的 **`/health`**：服务存活与 Agent 配置状态；Agent 显示可用不代表已成功调用模型。
- API 端口的 **`/ready`**：执行数据库查询，成功返回 ready，失败返回 503；不检查 QQ 或模型。
- **网页“今天”页**（`/api/web/today`，`chat.today`）：工作区级运行状况与待办，遵循 API 认证。

健康接口不能替代端到端验收。不要为了探测健康而关闭认证。

## QQ 状态与绑定

按 [QQ 配置步骤](../../README.zh.md)配置私有密钥文件并生成绑定码：

```bash
chrona qq bind-code --workspace ws_default
```

发送 `绑定 <码>` 到独立 Bot 私聊。默认有效十分钟，可用 `--ttl <minutes>` 指定 1–60 分钟。已有绑定时，只有明确授权更换主人才能用 `--replace`；替换必须留在同一工作区。正常对话不需要前缀。

状态文件在 `qq` 模块的数据目录：`<dataDir>/platform/data/<qq 模块 id>/status.json`（`chrona admin modules` 可查模块 id）。升级到模块化版本后，旧目录（`CHRONA_QQ_STATE_DIR` 或 `<dataDir>/qq-bot/<appId>`）中的 `binding.json`、`seen.json` 会在首次启动时复制过去，旧目录保留不动。模块启动、消息处理后及每 30 秒更新状态，包含更新时间、gateway、token、bound、绑定时间、ownerHash 和 challengePending。检查时间是否仍在更新、网关与 token 状态以及是否已绑定。绑定成功不代表后续推送必然被 QQ 接受。

同目录的绑定与挑战文件是私有状态，不要公开；绑定码只存哈希，CLI 输出的明文码应保密。QQ 平台的发送限制与 Chrona 打扰预算都可能影响通知，先看网页发件箱状态，不要绕过预算补发。

## 确认 Agent 真正可用

**升级前置条件：** 不再默认启动 PATH 中的 `pi`，也不再继承个人 Pi profile。依赖旧默认值的安装若直接部署，会显示 Provider 不可用。先由 owner 准备专用执行入口/profile/认证，再安排切换与回滚；不要自动复制个人凭据或顺带升级 Pi。

配置示例（路径须替换，非自动安装/迁移脚本）：

```bash
export CHRONA_STEWARD_PI_COMMAND=/opt/chrona/pi/bin/pi
export CHRONA_STEWARD_PI_VERSION=0.85.0
export CHRONA_STEWARD_PI_AGENT_DIR="$CHRONA_DATA_DIR/providers/pi"
install -d -m 700 "$CHRONA_STEWARD_PI_AGENT_DIR"
# 另行以服务用户，用选定 Pi 和以下环境准备模型认证/配置：
# PI_CODING_AGENT_DIR="$CHRONA_STEWARD_PI_AGENT_DIR" "$CHRONA_STEWARD_PI_COMMAND"
```

1. 审查并固定专用可执行文件，不附带 shell 参数。不要直接复用会追加日常扩展/主题/配置的交互式包装器。版本输出须精确匹配配置；当前只接受 `0.85.0` 和 `1.3.0` 及以后的 `1.x`（1.x 小版本按 semver 视为 RPC 兼容），0.85 与 1.x 能力并不等同，不据本机版本推断服务能力。应用的有界模型调用（补全）只在精确 1.5.0 上可用；其他版本上健康检查报告不可用，日志事件 pi-completion completion_failed / pi completion_unavailable 给出原因。
2. profile 须已存在、为绝对规范路径且不经符号链接，不与会话目录树重叠；默认 `<dataDir>/providers/pi` 可以位于数据根目录内。Unix 下不得有 group/other 权限（建议 `0700`），并应由服务用户管理。Chrona 不自动创建它、不复制认证。实际传给 Pi 的变量为 `PI_CODING_AGENT_DIR`。该目录仅隔开服务资源与可写状态，不是完整的宿主私密信息读取隔离。
3. 设置 `CHRONA_STEWARD_AGENT=pi`，检查 Chrona 工具扩展有效；需要网页工具时显式设置已审查的网页扩展。保留关闭资源自动发现及 `--no-approve` 项目信任拒绝。每次启动在提示/注入前查询 `get_commands`，拒绝不属于显式扩展/技能的命令资源。可选资源清单须为 profile 和事务树之外、私有、规范路径的 JSON 文件，入口只接受明确的本地文件及三个已列明的 Pi 1.3 内置扩展；修改后重启，不自动安装或发现资源。配置与原生 MCP 限制见 [Provider 运行说明](provider-runtime.md)。命令检查不覆盖任意包装器代码或仅注入工具的扩展，不能替代入口审查。
4. 重启后查看设置 → 运行状况及 `/health`。缺命令/profile/扩展、版本不符、未启用或正在停止都可能使 Agent 不可用。健康检查不发送模型请求，也不验证认证、完整工具清单或真实交互链路；命令资源检查发生在具体运行启动时。
5. 由 owner 在网页输入一个无敏感内容的简单问题，确认收到实际回答。再交代一件小事务，确认有进展或成果；只出现排队状态不能算成功。另行核验取消、恢复、补充消息及跨日任务。
6. 失败时查看事务技术详情、运行状况和日志，区分配置/版本、模型认证、扩展交互、超时和工具失败。Pi 的 select/confirm/input/editor 显示在全局待答复区，不仅在当前事务页。请求受本次 deadline 与自身 timeout 的较早者限制（最长 5 分钟），过期/取消/暂停/结束/进程退出/重启后不能继续批准。收到答复只代表本次请求已记录，不代表外部动作已经执行。没有接入交互回调、请求超长或含已识别敏感信息时明确失败，绝不自动同意。需要人工输入的工作不宣称能全程无人值守。

第 5 步会调用真实模型并可能产生费用，属于人工验收，不应放进自动化测试。本次改动未执行真实模型或 QQ 验证，未修改线上配置。

## 脚本限制

Provider 自带文件、命令与网页工具，Chrona 不再维护脚本草稿/工具版本系统。本地执行只支持 `trusted-local`，模块、构建检查和 Provider 使用服务用户的 OS 权限；已移除 `required-isolation` 和 bubblewrap 包装。旧模式或非空 `CHRONA_STEWARD_SANDBOX_BWRAP` 明确报错，须移除配置后再使用可信本地执行。宿主文件不会默认隐藏，附件只读是 Agent 行为规则而非挂载限制。Manifest 和路由声明不构成对恶意代码的 OS 隔离。Chrona 的路由授权、路径访问审批和对外动作审批仍保留，OS 可访问性不等于用户授权。

模块入口与检查命令由 `packages/integrations/src/steward/runtimes.json` 声明，发行包对应 `resources/runtimes.json`。运行器按扩展名选择宿主解释器和参数，直接启动进程，不再经过 `sh` 包装、`ulimit -v` 或设置 `MALLOC_ARENA_MAX`。当前 `.ts` 使用 Bun 和 TS 运行包的 SDK loader / `check` 命令；`.py` 优先模块内 venv（POSIX 为 `.venv/bin/python`，Windows 声明为 `.venv/Scripts/python.exe`），否则按声明找宿主 Python；只有 `.sh` 入口需要宿主 Shell。未声明 `check` 的运行时跳过类型检查，不跳过其他安装检查。不要在 manifest 中保留 `limits.virtualMemoryMb` 或 `limits`，严格 schema 会拒绝旧字段。

超时、输出上限、并发与模型预算、取消和实际停止证据继续由相应执行路径治理；不再承诺硬虚拟内存限制。模型额度不是 OS 内存上限。运行时声明和路径修复属于 S1，不能据此宣布 Windows/macOS 完整支持：本地 socket/IPC 与进程监管的跨平台工作及三端验收仍待 S4；S2–S6 未由本文宣告完成。阶段范围见[可移植实施方案](kernel-portability-plan.md)。

新激活的外置模块版本若在任何事件投递前启动失败，Chrona 自动切回前一已批准版本一次，无需开关或长期授权，入口/网络模块也适用。候选与目标均须已批准且 manifest 有效，模块仍为当前 active 激活与 hash、尚无已验证能力；数据 schema 必须与前版及当前数据一致，且无迁移/恢复记录、非分组激活、无动态或变化的日程。内置故障只重启/暂停/诊断，不回到旧 store 代码。不满足条件时按[模块故障诊断与恢复](module-recovery.md)人工处理。自动回滚保留当前数据和兼容静态日程，不重建日程、不重放工作；恢复目标不会继续自动回滚。
