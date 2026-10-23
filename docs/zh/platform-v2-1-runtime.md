# v2-1 规格：模块运行模型——常驻、事件驱动，去掉回放

状态：草案，未实现（2026-10-22）。总纲见 [platform-v2](platform-v2.md)；是 v2-2 至 v2-5 的前提。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 决定

1. **去掉回放与模拟。** P3 的并行模拟（`module-replay.ts`、`report.replay`）删除，范式中的"纯度"不再是设计约束。理由：
   - 历史回放做不到（P3 已发现：模块有状态，运行记录不含当时数据），退化成"用未来 10 次定时触发对比新旧版本"；
   - 含网络的模块一律跳过，而有用的模块大多联网；
   - 结果从不拒绝构建，唯一作用是给自动启用把关；
   - 却反过来约束了模块写法（一次性进程、输出意图）和后续设计（模型响应录制、模块分类）。
2. **模块是常驻、事件驱动的进程。** 不再有"一次性模块"与"常驻模块"之分。

## 2. 模块

### 2.1 清单

```json
{
  "name": "github-trending",
  "version": 2,
  "entry": "index.ts",
  "triggers": [{ "id": "daily", "schedule": { "kind": "daily", "at": "09:00" } }],
  "tools": [],
  "listen": null,
  "keepAlive": false,
  "content": false,
  "effects": ["network", "model", "notify_user"],
  "model": { "maxCalls": 3, "maxOutputTokens": 2000 },
  "params": {},
  "data": { "schema": 1 },
  "tests": ["test.ts"]
}
```

与现状相比：`affair` 字段在 v2-2 删除（之前保留）；新增 `listen`（HTTP 路径，v2-4）、`keepAlive`、`content`（内容区，v2-2）；`effects` 改称能力声明，含义扩展为"模块可调用的内核方法与沙箱权限"，取值见 §2.4。

### 2.2 进程生命周期

- **启动**：`keepAlive: true` 的模块在启用时启动；其余在第一个事件到来时启动。
- **空闲停止**：非 `keepAlive` 模块空闲 10 分钟后由内核停止，下个事件再拉起。
- **崩溃**：按退避重启；连续 3 次启动失败或事件处理失败 → 模块 `paused`，发通知（沿用现有规则）。
- **切换版本**：启动新版本进程；新事件发给新进程；旧进程处理完在途事件后停止。
- **状态**：持久状态只能写数据目录 `platform/data/<moduleId>/`；内存只作缓存，内核可随时重启进程。
- **隔离是可选加固**（2026-10-23 用户决定）：有可用的 bwrap 时模块在沙箱中运行（只读代码、可写数据目录、默认无网络，声明 `network` 才联网）；没有时以 Chrona 运行用户身份作为普通子进程运行（同 Hermes 的 local 后端），环境变量只保留 `PATH`/`HOME`/`LANG` 与 `CHRONA_*`，独立进程组，停止时整组结束。两种方式都有内存上限与超时。
- 未隔离时：经内核的方法（`notify`、`model`、`owner`、凭据……）照常检查；`network` 与文件范围只是声明、不被强制；模块新版本一律需要用户批准（不自动启用），审批卡注明"未隔离"。
- 模块代码不写死路径：`chrona.paths.{module,data,content}`（来自 `CHRONA_MODULE`/`CHRONA_DATA`/`CHRONA_CONTENT`），沙箱内分别是 `/module`、`/data`、`/content`。

### 2.3 与内核的通道

每个模块进程一个 Unix socket（路径在 `CHRONA_SOCKET`；沙箱内是 `/chrona/chrona.sock`），每行一个 JSON，双向：

- 内核 → 模块：事件 `{ "id", "event": { "kind": "schedule" | "inbound" | "tool" | "http" | "content_edit", ... } }`（`http` 见 v2-4，`content_edit` 见 v2-2）；模块回 `{ "id", "result" }` 或 `{ "id", "error" }`。
- 模块 → 内核：调用 `{ "id", "method", "params" }`；内核回 `{ "id", "result" }` 或 `{ "id", "error": { "code" } }`。

SDK 是名为 `chrona` 的包（`sdk.ts`、`testing.ts`），封装协议。沙箱内挂载在 `/node_modules/chrona`；未隔离时内核把它放在 `<dataDir>/platform/node_modules/chrona`（模块代码目录的上级），构建目录里放在 `node_modules/chrona`。Bun 以 `--no-install` 运行，缺包时不会去 npm 下载同名包。

```ts
import { on, chrona } from "chrona";
on("schedule", async ev => {
  const list = await (await fetch("https://github.com/trending")).text();
  const brief = await chrona.model({ system: "总结为中文简报……", prompt: list, maxOutputTokens: 1500 });
  await chrona.notify({ key: `trending:${ev.firedAt.slice(0, 10)}`, level: "now", title: "GitHub Trending", body: brief });
});
```

其他语言按协议直接连接。

- 每个事件的处理有超时（默认 60 秒；声明 `model` 的模块用 L1 `moduleModel.timeoutMs`）。
- v1 同一模块的事件串行处理。

### 2.4 内核方法（按能力声明开放）

| 能力 | 方法 | 说明 |
|---|---|---|
| `notify_user` | `notify` | 经通知预算；`key` 为幂等键 |
| `wake_provider` | `wakeProvider` | 唤起 Provider，内容按 untrusted data 注入（v2-2 之前唤起模块所属事务；之后在全新会话中运行，见 v2-2 §2.4） |
| `model` | `model` | v2-3 |
| `owner` | `owner.*` | v2-4 |
| `secret:<connector>` | `secret.get` | v2-4 |
| `network` | — | 沙箱联网，不经内核（未隔离时不强制） |

对外动作（发邮件等）不作为内核方法开放，改由声明了 `action` 的模块工具执行并经策略层审批（v2-5 §2）。

未声明的方法一律拒绝。原"模块输出 `effects` 数组、内核逐条执行"的方式取消，改为直接调用；检查（清单、L1 策略、预算、幂等键）与执行通道不变。

### 2.5 归属与幂等

- 内核方法调用一律归属**调用它的模块**：按该模块的能力、策略与预算判定。事件带来源（会话 id、调用方模块），仅用于审计。v2-2 删除事务之前，策略与预算仍按模块所属事务判定。
- 处理某个事件期间的幂等键为 `<eventKey>:<key>`；入站事件的 `eventKey` 为 `inbound:<inboundItemId>`（沿用 P5）。
- 每次调用记录在 `ModuleCall`（替代 `ModuleRun.executed`）：模块、版本、事件、方法、参数摘要、结果。

## 3. 构建与启用

构建（`module-build.ts`）保留：

1. 清单校验；能力 ⊆ L1。
2. 测试（`chrona/testing` 的假内核应答，`model` 返回占位文本，`notify` 等只记录不执行）。
3. 试启动：进程启动并正确应答一个合成事件（每个 trigger 一个；`tools` 每个一次）。
4. 数据：在副本上执行迁移、连续性检查（P2）。
5. 幂等键检查（P5）：对同一 trigger 送两个不同时刻的合成事件，比较 `notify` 等调用的键。

删除：P3 并行模拟、`report.replay`、审批卡片的模拟差异区。

自动启用条件改为：用户授权过（v2-2 之前按事务，之后按模块）、**无新增能力、无迁移、测试与试启动全部通过**。这不能发现隐藏的规则变化（例如悄悄加的门槛），所以自动启用后的告知必须带意图声明与代码 diff 链接，便于一键回滚。

## 4. 现有模块

现有模块是"stdin 输入、stdout 输出 effects"的一次性写法，不兼容。部署时：

- 列出所有已启用模块，经用户批准后停用（属于真实用户数据的变更）；
- 由 Provider 经构建通道按新写法重新提案，每个仍需审查启用。

不保留旧执行器。

## 5. 文档与代码影响

- 范式文档 §4、§5.3、§7b、§8、§9 去掉回放与纯度；plan §3.2、§3.3、§4.3、§4.4、P3 同步。
- 删除 `module-replay.ts` 及其测试与 UI；`schedules.ts`、`module-inbound.ts`、`module-tools.ts` 改为向模块进程投递事件；`module-effects.ts` 改为内核方法处理器；`script-sandbox.ts` 增加常驻进程与 socket 绑定。
- 构建通道提示词改为新写法。

## 6. 验收

1. 定时模块：第一次触发时进程启动、处理、空闲 10 分钟后停止；下次触发再启动。
2. `keepAlive` 模块在启用后立即运行，杀掉进程后按退避重启；连续失败 3 次后 `paused` 并通知。
3. 未声明 `notify_user` 的模块调用 `notify` → 被拒绝，记录在 `ModuleCall`。
4. 新版本启用时，在途事件由旧进程处理完，新事件进新进程；不丢事件、不重复通知。
5. 入站邮件、工具调用经同一进程处理；幂等键规则同 P5。
6. P3 模拟代码与报告已删除；自动启用在"无新增能力、无迁移、测试与试启动通过"时生效，告知带 diff 链接。

## 7. 未决问题

- 并发：同时运行的模块进程上限、内存总量。
- 同一模块事件是否需要并行处理（v1 串行）。
- 空闲时长 10 分钟是否合适。
