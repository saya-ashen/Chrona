# Mind — 正在替你留意和推进

新版产品与接口设计见 `plans/029-mind-redesign/design.md` 和 `contracts.md`。Mind 是普通应用：理解真实使用情况，持续推进明确目标，并用实际证据核对成果。页面安装、来源文本与模型输出都不能授予权限。

## 新版可执行界面

`workspace-ui.tsx` 实现 React 界面，`workspace.css` 提供限定在 `.mind-root` 内的响应式样式。`build.ts` 将 React 一并打包为自包含浏览器 ESM `dist/workspace.js`；无需外部运行时导入。组件不直接访问网络、模型或本机资源，通过宿主 `context.call` 使用受治理的应用工具。

默认导出与 Chat 的可执行组件生命周期一致：

```ts
mount(element: HTMLElement, context: {
  props?: {
    view?: 'overview' | 'understanding' | 'connections' | 'settings';
    title?: string;
  };
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}): {
  update(nextContext): void;
  destroy(): void;
}
```

注册名建议 `MindWorkspace`，注册内容使用 `dist/workspace.js` 和 `workspace.css`。Props schema 为 object，以上两个可选属性，`additionalProperties: false`。页面注册由入口协调层负责；本组件不会自行注册页面或修改旧 UI 接线。构建将 JS 与 CSS 总和限制为 245 KiB，为 256 KiB 的组件注册上限预留元数据空间。

界面包含：

- **概览**：需要你决定、正在推进、已经帮你做成；可展开成果正文、核对方式、依据和未知项。
- **对你的理解**：区分明确表达与推断，显示作用范围，按文本、项目与会话检索；可纠正或确认遗忘。
- **接入与自主范围**：展示来源覆盖、缺口、能力可用性与真实检查记录；未提供的验证和费用保持未知。
- **设置**：后台推进、学习、通知、时区与安静时段；预算仅在服务提供可编辑字段时开放，已知执行预算可只读展示。
- **自然输入**：交给 Mind 推进、保存明确偏好，或补充当前事项。补充要求保留原目标与已有完成条件。

成果以转义后的 React 文本节点渲染 Markdown 子集，支持标题、列表、代码块、强调与安全链接；原始 HTML 不执行，可切换纯文本。实际文档字段 `body` 和 `format` 均可读取。

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

测试复用已有 Chat 的 Happy DOM 依赖；构建使用工作区已有 React 与 ReactDOM。15 个 DOM 用例验证用户可见的加载、空态、读失败恢复、Markdown/纯文本、真实文档字段、控制和反馈、遗忘确认与焦点、旧响应失效、结果未明的同键重试、确定性冲突、设置 revision、项目/会话检索、补充目标及卸载清理。其中一个用例接入临时 SQLite 的真实 Core 服务，走通提交目标、暂停、保存理解和遗忘；不调用真实模型、外部服务、账号或通知。

实际浏览器验收由页面协调层执行，建议尺寸为 1440×900、1024×768、390×844，检查页面水平溢出、可读结果、设置和移动端确认框。DOM 测试与构建通过不等同于浏览器视觉验收、真实模型接入或部署。
