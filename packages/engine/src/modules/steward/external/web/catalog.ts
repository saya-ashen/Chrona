import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { z } from "zod";

/**
 * What apps may put on the pages they register (module-dependency-direction §4): the json-render shadcn components this
 * page draws in its own style, its Markdown, and one `call` action. src/pages.tsx implements exactly these.
 */
export const CATALOG_VERSION = "json-render@0.21.4";
const SHADCN = ["Card", "Stack", "Grid", "Separator", "Heading", "Text", "Badge", "Alert", "Table", "Button", "Link", "Input", "Textarea", "Select", "Checkbox", "Switch", "Spinner", "Progress", "Pagination", "Collapsible"] as const;
type Definition = { props: z.ZodObject<Record<string, z.ZodType>>; events?: string[]; slots?: string[]; description: string };
export const components: Record<string, Definition> = {
  ...Object.fromEntries(SHADCN.map(name => [name, (shadcnComponentDefinitions as Record<string, Definition>)[name]!])),
  Input: { ...shadcnComponentDefinitions.Input, props: shadcnComponentDefinitions.Input.props.extend({ disabled: z.boolean().optional() }) },
  Textarea: { ...shadcnComponentDefinitions.Textarea, props: shadcnComponentDefinitions.Textarea.props.extend({ disabled: z.boolean().optional() }) },
  Select: { ...shadcnComponentDefinitions.Select, props: shadcnComponentDefinitions.Select.props.extend({ options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])) }), description: "下拉选项可为字符串或 {value,label}；value 支持双向绑定" },
  Workspace: { props: z.object({ sidebarLabel: z.string().optional(), mainLabel: z.string().optional(), sidebarOpen: z.boolean().optional(), mobileSidebarOpen: z.boolean().optional(), breadcrumb: z.string().optional(), title: z.string().optional(), description: z.string().optional() }), slots: ["default", "sidebar"], events: [], description: "响应式侧栏和内容工作区；sidebar 为侧栏，children 为内容；sidebarOpen 可双向绑定；mobileSidebarOpen 可单独控制手机侧栏，不影响桌面选择" },
  WorkspaceHeader: { props: z.object({ title: z.string(), subtitle: z.string().optional(), status: z.string().optional(), statusTone: z.enum(["neutral", "success", "warning", "danger"]).optional() }), slots: ["default"], description: "工作区标题、状态和副标题；statusTone 默认 neutral，由页面声明状态语义；子组件显示补充信息" },
  ViewTabs: { props: z.object({ items: z.array(z.object({ value: z.string(), label: z.string() })), value: z.string().optional() }), slots: [], description: "本页视图标签；value 支持双向绑定，不导航或刷新" },
  Composer: { props: z.object({ hint: z.string().optional(), footnote: z.string().optional(), disabled: z.boolean().optional() }), slots: ["default", "actions"], events: ["submit"], description: "集成输入区；children 放 Textarea 和重试，actions 放按钮；Enter 触发 on.submit，Shift+Enter 和输入法组合不提交；disabled 禁止键盘提交，按钮由页面单独绑定操作和禁用状态" },
  Panel: { props: z.object({ tone: z.enum(["default", "question", "muted"]).optional() }), slots: ["default"], description: "带内边距的通用内容区域，可强调问题或弱化内容" },
  ScrollArea: { props: z.object({ label: z.string().optional(), follow: z.boolean().optional() }), slots: ["default"], events: [], description: "独立滚动区域；保留阅读位置，follow 仅在靠近底部时自动跟随" },
  Message: { props: z.object({ author: z.string(), time: z.string().optional(), tone: z.enum(["default", "user", "notice"]).optional() }), slots: ["default"], events: [], description: "带作者、可选 ISO 时间和正文子组件的消息" },
  CodeDiff: { props: z.object({ filename: z.string().optional(), diff: z.string() }), slots: [], events: [], description: "安全显示 unified diff、行号和增删统计；长行在区域内横向滚动" },
  ActionOption: { props: z.object({ label: z.string(), description: z.string().optional(), selected: z.boolean().optional(), disabled: z.boolean().optional(), compact: z.boolean().optional() }), slots: [], events: ["press"], description: "可选择的操作选项；compact 显示紧凑列表行；通过 on.press 使用现有动作" },
  List: { props: z.object({}), slots: ["default"], description: "带分隔线的列表；每个子组件作为一个列表项" },
  Link: { ...shadcnComponentDefinitions.Link, props: shadcnComponentDefinitions.Link.props.extend({ label: z.string().optional(), current: z.boolean().optional() }), slots: ["default"], description: "链接；label 或子组件作为内容，current 标记当前页" },
  TabNav: { props: z.object({ items: z.array(z.object({ label: z.string(), href: z.string(), current: z.boolean() })) }), description: "页面标签导航；current 标记当前页，包含 aria-current" },
  Article: { props: z.object({}), slots: ["default"], description: "独立文章区块，使用语义 article" },
  Preformatted: { props: z.object({ text: z.string() }), description: "保留换行和缩进的纯文本；不执行 HTML" },
  Image: { props: z.object({
    ref: z.string().describe("本应用内容引用 <本应用名>/<path>；可用 $state/$template 绑定"),
    alt: z.string(), width: z.number().nullable().optional(), height: z.number().nullable().optional(),
  }), description: "本应用内容区的图片（PNG、JPEG、GIF、WebP）；ref 是 <本应用名>/<path>，可用 $state/$template 绑定，不接受 src URL" },
  Markdown: { props: z.object({ content: z.string() }), description: "Markdown text: headings, lists, tasks, code, bold and links (no HTML)" },
  Time: { props: z.object({ value: z.string() }), description: "ISO 时间，以 zh-CN 显示本地年月日和时分；空值或无效值显示时间未知" },
  CollapsedText: { props: z.object({ content: z.string(), limit: z.number().int().min(1).max(2000).optional() }), description: "长正文默认折叠为 160 字，可展开和收起；limit 可调整折叠字数" },
};
export const callParams = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).describe("One of the registering app's own tools"),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments; values may be { $state: \"/path\" }"),
  result: z.string().startsWith("/").optional().describe("State path that receives the tool's result"),
  reload: z.boolean().optional().describe("Re-read the page's data afterwards (default true)"),
});
export const catalog = defineCatalog(schema, {
  components,
  actions: { call: { params: callParams, description: "Call one of this app's own tools for the user" } },
});
/** json-render's own state actions, handled by its runtime. */
export const BUILTIN_ACTIONS = new Set(["setState", "pushState", "removeState", "validateForm"]);
