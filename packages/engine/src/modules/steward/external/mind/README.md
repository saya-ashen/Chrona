# Mind — 正在替你留意和推进

新版产品与接口设计见 `plans/029-mind-redesign/design.md` 和 `contracts.md`。Mind 是普通应用：理解真实使用情况，持续推进明确目标，并用实际证据核对成果。页面安装、来源文本与模型输出都不能授予权限。

## 新版可执行界面

`workspace-ui.tsx` 实现 React 界面，`workspace.css` 提供限定在 `.mind-root` 内的响应式样式。`build.ts` 将 React 一并打包为自包含浏览器 ESM `dist/workspace.js` 和压缩后的 `dist/workspace.css`；无需外部运行时导入。组件不直接访问网络、模型或本机资源，通过宿主 `context.call` 使用受治理的应用工具。

默认导出与 Chat 的可执行组件生命周期一致：

```ts
mount(element: HTMLElement, context: {
  props?: {
    view?: 'overview' | 'improvements' | 'understanding' | 'settings';
    title?: string;
  };
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}): {
  update(nextContext): void;
  destroy(): void;
}
```

注册名建议 `MindWorkspace`，注册内容使用 `dist/workspace.js` 和 `dist/workspace.css`。Props schema 为 object，以上两个可选属性，`additionalProperties: false`。页面注册由入口协调层负责；本组件不会自行注册页面或修改旧 UI 接线。构建将 JS 与 CSS 总和限制为 245 KiB，为 256 KiB 的组件注册上限预留元数据空间。

界面包含四个入口：

- **概览**：需要决定、正在改进、最近完成各展示最多三项；详细列表在“改进”。
- **改进**：统一管理已有应用修改和新应用制作，支持状态筛选、暂停、补充、结束；候选材料和原回执在这里审阅。
- **理解与反馈**：检索有出处的偏好与推断，纠正、遗忘；应用反馈可以选择应用和问题页面。
- **设置**：学习与后台范围、整理模型和主模型、预算、通知；来源和技术授权折叠展示，打开后才读取。

Web 的“反馈此页”将页面实际应用、版本和路径带入 Mind，由用户填写并确认提交；不自动发送页面内容、查询参数或未发送草稿。反馈形成同一个持续改进事项；完成后的“仍未解决”重新打开原事项，保留新反馈依据。

### 分级整理与应用来源

`organizerModel` 配置可选整理模型（例如用户已有的 `provider/model`），`organizerProviderId` 指定可选 Provider；`mainModel/mainProviderId` 用于主工作与独立语义核对。留空沿用默认配置，不修改 Pi Profile。

代码先以来源事件 ID 去重并合批。用户消息与纠正直接进入主模型；整理模型仅处理应用操作记录，输出摘要、原始证据引用及 `investigate/defer/uncertain`。结果必须来自当前真实执行的成功工具回执；没有合法结果就回到主模型。暂缓批次每日复查，也可手动核对；关闭整理模型后不继续过滤。整理执行最长三分钟，未知停止仍占用原执行槽位；两类模型共用既有后台执行预算及队列，次数可见；未取得可靠计量时费用保持未知。Provider 原生权限不因工具选择缩小。

应用可在其批准版本声明 `mind.observe` 后报告自身有界操作：`{input: JSON.stringify({eventId,operation,outcome:'succeeded'|'failed'|'unknown',detail?,page?})}`。身份和版本取实际调用者，不能代报其他应用或声称用户授权。稳定 eventId 去重，暂停学习拒绝新摄入。原始事件沿用现有保留与遗忘机制；整理摘要仅供后续分流，30 天或来源撤回时清理。其他应用需主动接入，接口存在不代表全系统操作已被采集。

### 修改已有应用

`delivery.prepare.items[]` 更新已有应用时携带 `baseline:{moduleId,expectedActiveHash}`；新增应用不传 baseline。准入证明、提交前目录及原回执均核对相同目标和版本，阻止过期候选覆盖新版本。Mind、Chat、Web、Author 等普通应用可作为更新目标；kernel 不在范围内。

当前 Agent 导出已有源码、修改和检查，Author 运输精确材料，现有生命周期协调者负责审批、排空和激活。Mind 自更新必须先完成当前执行和交接，由外部生命周期接管；没有测试证明时不声称已完成自更新验收。`autoSubmit` 只自动提交候选，不等于批准或安装。启用后继续核对原目标。

### 开发接续与成果核验

后台开发使用十分钟活动窗口；整理操作记录仍为三分钟。当前 Run 在结束前可用 `mind.action` 保存实际工作目录、修改材料、检查结果和下一步，再提交带成果引用及 `nextStep` 的进展。运行时从已有成果与候选中恢复接续上下文，带回上次失败原因和原效果身份；不要求模型从头重建。新成果且仍需继续，或者独立核验未通过时，沿用同一目标安排修复；相同输入最多三次尝试，间隔一分钟、五分钟。相同内容换一个成果 ID 不算新进展。用户决定、权限和外部等待不会因此自动继续；未知效果仍查询原回执。

自动改进每天八次的上限只限制自动改进，不挡住用户明确任务。所有后台执行继续共享每日二十四次启动预算。`autoSubmit` 只控制新的自动提交；关闭后仍跟踪已经发出的交付及原回执。发送前已确定失败或候选明确拒绝后释放事项阻塞，保留原因；传输丢失或无法证明未发生的提交不冒充失败。

Agent 的 `detail` 返回成果索引。小文档的 `artifact` 直接返回正文；大文档返回 `artifact-manifest`，随后以 `{ref,offset:0}` 开始，按每段 `nextOffset` 读到 `null`。offset 使用 UTF-16 字符位置，分段不会拆开代理字符对。独立核验核对每一段的真实工具结果与持久正文；只读摘要或提供摘要散列不能通过。单次核验的完整读取和 verdict 仍受工具调用预算约束，超出时返回具体原因供缩小候选成果范围。

成果以转义后的 React 文本节点渲染 Markdown 子集，支持标题、列表、代码块、强调与安全链接；原始 HTML 不执行，可切换纯文本。页面与 owner 仍可读取完整 `body` 和 `format`。

## 宿主工具合同

所有返回均为 `{ json: string }`，字符串解码后为对象。错误可返回 `{error:{code,message}}` 对象；传输失败可抛出异常。工具名相对于当前 Mind 应用，无需手动添加前缀。

| 工具 | UI 参数 |
| --- | --- |
| `overview` | 初始 `{}`；存在下一页时 `{after}` |
| `detail` | `{id}`；协调层解析对象种类并补充证据与文档 |
| `settings` | 读取 `{}`；保存 `{patch: JSON.stringify(变更字段), revision}` |
| `context` | `{query, scope:{projectId?,sessionId?}, limit:50, maxBytes:32768}` |
| `control` | `{input: JSON.stringify({kind,id,expectedRevision,operation,value?,completionCriteria?,...mutation})}` |
| `feedback` | `{input: JSON.stringify({targetKind,targetId,expectedRevision,value,scope,...mutation})}` |
| `forget` | `{input: JSON.stringify({target:{kind:'understanding'|'evidence',id},...mutation})}` |
| `remember` | `{input: JSON.stringify({expectedRevision:0,kind:'preference',value,scope:{},explicitness:'explicit',supportingRefs:[],opposingRefs:[],...mutation})}` |
| `pursue` | `{input: JSON.stringify({semanticKey,expectedRevision:0,goal,completionCriteria,scope:{},reason:'explicit-goal',evidenceRefs:[],understandingRefs:[],...mutation})}` |
| `check` | `{}` |

`mutation` 是 `{actionKey, expectedVisibilityRevision}`。UI 使用 overview 的撤回版本；对象操作还使用详情中的 revision。用户身份与权限由宿主提供，不能从工具 JSON 获取。控制操作为 `pause/resume/end/correct`，暂停由独立 `paused` 字段表示。

写请求响应丢失时，UI 保留原始输入与完整请求，阻止其他写入，只提供显式“重试原请求”。同一请求重试使用同一 actionKey 与参数。已编码的确定性拒绝会解除锁定，允许刷新版本后重新提交；不会把响应丢失当作操作失败。`compacted/forgotten` 回执不会冒充新写入成功。

遗忘有明确确认、焦点圈定、取消与 Escape 操作。成功后清空缓存并使未完成的旧读取失效。清理完成范围以服务回执为准，不承诺删除 Chat、Provider、外部消息或完成司法级擦除。暂停、结束和遗忘均不会把“已请求停止”显示成“原执行已确认停止”。

## 协调层接入注意

- `settings` 的公开参数只有 `patch/revision`。协调层须提供稳定幂等身份和当前撤回版本，再调用 Core；不能要求 UI 发送未声明字段。未知响应后的同一 patch/revision 重试必须保持同一身份。
- CoreSettings 当前没有 `dailyRunLimit/dailyOpportunityLimit/dailyNotificationLimit`。若开放预算编辑，协调层须投影实际配置并分流到执行器配置；不能直接把未知字段传给 Core。当前缺失时界面明确说明未提供可修改预算。
- 保留确定性错误码，如 `CONFLICT/FORBIDDEN/INVALID_INPUT`；若宿主把错误转为无 code 的普通 Error，UI 会按结果未明处理。
- overview 可直接返回 Core 的 `items/next/settings/visibilityRevision`，并补充 `health/budget/sources/capabilities`。详情支持原始对象或 `{item|pursuit|understanding,evidence,artifacts,unknowns}`；缺少证据正文时会按引用读取，部分失败明确展示。

## 本地验证

```sh
bun run packages/engine/src/modules/steward/external/mind/build.ts
bun test packages/engine/src/modules/steward/external/mind/workspace-ui.bun.test.ts
```

测试复用已有 Chat 的 Happy DOM 依赖；构建使用工作区已有 React 与 ReactDOM。DOM 用例验证用户可见的加载、空态、读失败恢复、Markdown/纯文本、真实文档字段、控制和反馈、遗忘确认与焦点、旧响应失效、结果未明的同键重试、确定性冲突、设置 revision、项目/会话检索、补充目标及卸载清理。其中一个用例接入临时 SQLite 的真实 Core 服务，走通提交目标、暂停、保存理解和遗忘；不调用真实模型、外部服务、账号或通知。

实际浏览器验收由页面协调层执行，建议尺寸为 1440×900、1024×768、390×844，检查页面水平溢出、可读结果、设置和移动端确认框。DOM 测试与构建通过不等同于浏览器视觉验收、真实模型接入或部署。
