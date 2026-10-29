# v2-25 规格：接口契约（返回结构、类型与运行时校验）

状态：规格已确认（2026-10-29）；第 1 步已实现，未部署；第 2、3 步待做。依赖 [v2-5](platform-v2-5-extensions.md) §3、[v2-13](platform-v2-13-modules-tools.md)、[v2-24](platform-v2-24-timers.md)。

## 1. 背景

模块之间只通过路由调用交互（v2-8），构建会话里的 AI 只能从 `m_modules_reference` 了解一个接口：描述、入参、返回结构和示例。构建规则要求“返回结构为空就不许猜字段”，缺资料就停下（`BUILD_REFERENCE_PROMPT`）。这条规则是对的，问题在资料本身：

- 系统工具 60 个，应用能调用的约 51 个，只有 `modules.diagnostics/overview/settings-set` 声明了 `output`。v2-24 日历构建因 `schedules.mine/list` 没有返回结构整轮停下。
- 应用 manifest 的工具（`moduleToolSchema`）不能声明返回结构，调用其他应用（如 `planning.get`）同样只能猜。
- 路由不检查返回值：系统工具与应用工具的输出原样交给调用方（`module-calls.ts` 的 `invokeSystemSync` 与模块回复）。说明和行为可能不一致，且没人发现。
- 应用代码是 TypeScript，但 Bun 只去掉类型、不检查；构建检查只跑 `tests`。`chrona.call<T>()` 的 `T` 由调用方随意填写，等于没有类型。

后果：调用方的离线测试按 AI 自己猜的形状做 stub，检查能过，上线才对不上；被调用方改了返回字段，调用方不会提前知道。

## 2. 原则

- 一个接口的契约 = 入参 + 返回结构，**同一份来源**生成三样东西：`m_modules_reference` 的说明、构建工作区里的 TypeScript 类型、路由的运行时校验。说明、类型和行为不会各说各的。
- 应用能调用的接口（`visibility` 含 `modules` 或 `owner`）必须声明返回结构；只给 Provider 的 `m_*` 工具不在此列（Provider 看到的是工具结果文本）。
- 已上线的应用不追溯：没有返回结构的旧版本照常运行，下次构建时才强制。

## 3. 第 1 步：系统工具的返回结构

- `SystemTool.output`（zod）对所有 `visibility` 含 `modules` 或 `owner` 的系统工具成为必填。优先复用 `@chrona/contracts/steward` 中已有的视图 schema（`scheduleSchema`、会话、消息、审批、运行、授权、偏好等），不重复定义。
- 新增一条内核测试：遍历 `registerSystemModules()` 后的全部系统工具，缺 `output` 即失败。以后新增系统工具漏写返回结构，CI 不通过。
- 一并修正描述与行为不一致之处：`schedules.list` 实为“全部状态、按创建时间倒序”，描述改为与行为一致（不改行为，web 现有页面依赖它）。
- 路由对系统工具的输出按 `output` 校验：不符合时记录 `call.output_mismatch` 日志与诊断，但**仍返回**原值——这是内核自己的缺陷，不能因此打断应用；内核测试中不符合直接失败。
- `m_modules_reference` 无需改动：已按 `tool.output` 输出 `outputSchema`。

## 4. 第 2 步：构建时的类型检查

- 每次构建写入 SDK 时（`writeBuildHelpers`），同时生成 `node_modules/chrona/calls.d.ts`：
  - `interface ChronaCalls { "<module>.<tool>": { args: …; output: … } }`，覆盖全部系统工具与已启用应用中声明了 `output` 的工具；未声明的应用工具 `output` 为 `unknown`（不是 `any`）。
  - 类型由契约生成：系统工具 zod → `z.toJSONSchema` → TS 类型文本；应用工具直接从 manifest 的 JSON Schema 转。转换只支持契约允许的子集（object/array/string/number/boolean/null/enum/const/union/record），不认识的结构生成 `unknown`。
- `sdk.ts` 的 `chrona.call` 增加按目标推断的重载：`call<K extends keyof ChronaCalls>(target: K, args: ChronaCalls[K]["args"]): Promise<ChronaCalls[K]["output"]>`；目标不在表中时返回 `Promise<unknown>`。`chrona.secret/model/notify/events.emit` 等快捷方法改用同一张表。
- 构建检查在跑 `tests` 之前增加类型检查：内核用 TypeScript 编译器 API（`ts.createProgram`，`strict`、`noEmit`，只读 staging 目录和生成的 `calls.d.ts`）检查候选代码。只解析不执行，不进沙箱也安全；限时 30 秒。有错误则版本 `rejected`，报告 `report.typecheck`（文件、行、信息，截断后进入失败回报）。
- `typescript` 从 devDependencies 移到 dependencies，随发布包分发。
- 内置应用去掉 `// @ts-expect-error Chrona supplies the SDK at run time.`，在仓库 `tsconfig` 中把 `chrona` 映射到 `module-sdk/sdk.ts`，由仓库 `typecheck` 覆盖；发布时它们同样经过构建检查。
- 构建说明（`BUILD_REFERENCE_PROMPT`）补一句：离线测试的 stub 须符合 `ChronaCalls` 中的类型。

## 5. 第 3 步：应用工具的返回结构与运行时校验

- `moduleToolSchema` 增加 `output`：JSON Schema 对象，最多 8000 字符，须能被 `z.fromJSONSchema` 接受且只用 §4 的子集；manifest 校验时编译一次，失败即拒绝。
- 新构建中，`visibility` 含 `modules` 或 `owner` 的工具必须声明 `output`（`validateBuildManifest`）；内置应用（`notify`、`planning`、`memory-local`、`files`、`events`、`qq`、`web`、`mcp` 等）随本步补齐。
- 路由校验应用工具的输出：调用方收到之前按 `output` 校验，不符合则本次调用以 `failed` 结束（“返回值不符合声明的结构”），并作为被调用方的故障进入诊断。异步调用同样在写入 `call_result` 前校验。旧版本没有 `output` 时跳过校验。
- `m_modules_reference` 对应用工具返回 manifest 中的 `output`。
- 升级防破坏：新版本修改了某个工具的 `output`，且有其他已启用应用在 `uses` 中声明它时，检查报告列出这些调用方，审批卡标注“返回结构变化，影响：<应用>”。是否兼容由用户审批判断，内核不做 schema 兼容性推理。

## 6. 不做

- 不追溯校验已启用的旧版本，不自动重建它们。
- 不扩展应用工具的入参类型（仍是标量；复杂参数照旧用 JSON 字符串）。
- 不为 Provider 专用的 `m_*` 工具补返回结构。

## 7. 验收

- 第 1 步：缺 `output` 的系统工具让内核测试失败；`schedules.mine/list` 的 `m_modules_reference` 返回非空 `outputSchema`；系统工具输出不符时有日志、调用仍成功。
- 第 2 步：构建中 `chrona.call("schedules.mine")` 得到具体类型；用错字段的候选版本因类型错误被拒；内置应用通过仓库 `typecheck`。
- 第 3 步：缺 `output` 的新应用 manifest 被拒；返回不符的应用调用以 `failed` 结束并进入诊断；改变被依赖工具 `output` 的版本在审批卡上标注调用方。
