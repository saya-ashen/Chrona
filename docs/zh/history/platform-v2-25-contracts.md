# v2-25 规格：接口契约（返回结构、类型与运行时校验）

状态：规格已确认（2026-10-29）；第 1、2 步已实现；第 3 步（v2-27 P1a）已在本地实现并验证，尚未部署。依赖 [v2-5](platform-v2-5-extensions.md) §3、[v2-13](platform-v2-13-modules-tools.md)、[v2-24](platform-v2-24-timers.md)。

> 优先级更新：[v2-27](platform-v2-27-trusted-local-evolution.md) 将本文第 3 步列为 P1，接在可信本地执行与授权调整之后。P2 现已本地实现：应用工具支持受界递归对象／数组参数，并从同一 manifest 描述公开功能；本文其余接口契约范围不变。

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

- `calls.d.ts`（`module-contracts.ts` 的 `callsDeclaration`）：`interface ChronaCalls { "<module>.<tool>": { args: …; output: … } }`，覆盖 `visibility` 含 `modules` 或 `owner` 的系统工具与已启用应用的工具；没有声明返回结构的目标 `output` 为 `unknown`（不是 `any`）。类型由契约生成：zod → `z.toJSONSchema` → TS 类型文本，只支持契约用到的子集（object/array/string/number/boolean/null/enum/const/anyOf/allOf/record），其余（如 `$ref`）生成 `unknown`。
- 构建会话写入 SDK 时（`writeBuildHelpers`）把它写成只读的 `node_modules/chrona/calls.d.ts`，并提供 `chrona/typecheck.sh <moduledir>`。SDK 自带一份空的默认 `calls.d.ts`（运行时只是类型，被擦除）。
- `sdk.ts` 的 `chrona.call` 按目标推断：有契约的目标参数与结果都有类型（异步调用返回 `CallState`）；参数写错时没有退路可落；没有契约的目标结果为 `unknown`，调用方可写 `call<T>()` 表明预期。给有契约的目标写类型参数会被检查拒绝（代码 90001），因为那等于用猜测覆盖契约。SDK 的 schedule 事件补上 `scheduleId`、`payload`（v2-24 起就会传）。
- 构建检查在跑 `tests` 之前做类型检查（`module-typecheck.ts`）：用 Bun 在独立进程里运行 `check.ts`（限时 60 秒、虚拟内存 4 GB），以入口为根，跟随它的导入检查（`strict`）；测试文件不检查。`check.ts` 只读文件、不执行模块代码；缺依赖声明文件（TS7016）不算错。有错误则版本 `rejected`，报告 `report.typecheck` 并把前 50 条写进 `report.errors`，构建会话照常读到。入口不是 TypeScript，或类型检查资源不可用时跳过，不记入报告。
- 发布包随附 `resources/module-typecheck/`：`check.ts`、`typescript`（`package.json` 与 `lib/`）、`@types/bun`、`bun-types`、`@types/node`（约 25 MB，未压缩）。`typescript` 仍是开发依赖，打包时从 `node_modules` 复制。发布冒烟检查用包内资源检查内置 `remind`。
- 内置应用入口去掉 `// @ts-expect-error Chrona supplies the SDK …`，仓库 `tsconfig` 把 `chrona` 映射到 `module-sdk/sdk.ts`，由仓库 `typecheck` 覆盖（为此修正了 `remind`、`qq` 的事件参数类型）。内置应用的测试文件仍用 `chrona/testing` 的无类型写法，不在这一步。
- 构建说明（`BUILD_REFERENCE_PROMPT`）写明：契约在 `calls.d.ts`，不给有契约的目标写类型参数，提交前可用 `chrona/typecheck.sh` 自查，离线测试的 stub 须符合这些类型。

## 5. 第 3 步：应用工具的返回结构与运行时校验

- `moduleToolSchema` 增加 `output`：JSON Schema 对象，最多 8000 字符，须能被 `z.fromJSONSchema` 接受且只用 §4 的子集；manifest 校验时编译一次，失败即拒绝。
- 新构建中，`visibility` 含 `modules` 或 `owner` 的工具必须声明 `output`（`validateBuildManifest`）；内置应用（`notify`、`planning`、`memory-local`、`files`、`events`、`qq`、`web`、`mcp` 等）随本步补齐。
- 路由校验应用工具的输出：调用方收到之前按 `output` 校验，不符合则本次调用以 `failed` 结束，错误只包含归属及有限的 schema issue 路径，不包含实际返回值。异步调用同样在成功写入与 `call_result` 前校验。旧版本没有 `output` 时跳过校验；契约不匹配写入被调用方独立的 `contractFailures` 诊断，不改变传输重试、进程故障计数或恢复状态。
- `m_modules_reference` 对应用工具返回 manifest 中的 `output`。
- 升级防破坏：工具新增、删除，或 `output` 有增删改（比较时忽略对象键顺序）时，检查报告与单/分组审批预览列出声明了对应精确 target 的已启用调用方；owner 可见的 target 也检查 `uses: ["*"]`。审批评估和自动激活资格会重查当前调用方，存在影响至少要求 yellow 并禁止自动激活。是否兼容由用户审批判断，内核不做 schema 兼容性推理，也不自动重建调用方。

## 6. 不做

- 不追溯校验已启用的旧版本，不自动重建它们。
- 不为 Provider 专用的 `m_*` 工具补返回结构。
- 不扩展既有工具的参数语义；原有 JSON 字符串仍是字符串，不做自动解析或转换。新工具可声明嵌套对象／数组，闭合对象默认拒绝未声明字段；详见 [v2-27 §6](platform-v2-27-trusted-local-evolution.md)。

## 7. 验收

- 第 1 步：缺 `output` 的系统工具让内核测试失败；`schedules.mine/list` 的 `m_modules_reference` 返回非空 `outputSchema`；系统工具输出不符时有日志、调用仍成功。
- 第 2 步：构建中 `chrona.call("schedules.mine")` 得到具体类型；用错字段的候选版本因类型错误被拒；内置应用通过仓库 `typecheck`。
- 第 3 步：缺 `output` 的新应用 manifest 在测试前被拒；同步/异步返回不符以 `failed` 结束并写入 callee `contractFailures`，不引发传输失败恢复副作用；legacy output 不变；schema 增删改、键排序、移除工具、分组审批及最新调用方检查均有测试。
- 后续 P2（v2-27 §6）：原生递归参数、reference／Provider／owner MCP schema 与已验证范围见 [v2-27 的 P2 回归记录](platform-v2-27-trusted-local-evolution.md#p2-回归验证记录)。
