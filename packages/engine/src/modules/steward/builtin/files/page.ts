/**
 * The documents page this app registers with web (module-dependency-direction §4): a json-render spec over its own
 * list/read/write/delete tools. Web draws it; nothing here knows how.
 */
const setFile = (value: unknown) => ({ action: "setState", params: { statePath: "/file", value } });
export const PAGE = {
  id: "main",
  title: "文档",
  data: {
    list: { tool: "list", args: { dir: { $state: "/dir" } } },
    doc: { tool: "read", args: { path: { $state: "/file" } } },
  },
  spec: {
    root: "layout",
    state: { dir: "", file: "" },
    elements: {
      layout: { type: "Grid", props: { columns: 2, gap: "md" }, children: ["browser", "viewer"] },
      browser: { type: "Card", props: { title: "目录" }, children: ["up", "entries", "cut"] },
      up: { type: "Button", props: { label: "← 上一级", variant: "secondary" }, visible: { $state: "/list/parent", neq: null }, children: [],
        on: { press: [{ action: "setState", params: { statePath: "/dir", value: { $state: "/list/parent" } } }, setFile("")] } },
      entries: { type: "Stack", props: { gap: "sm" }, repeat: { statePath: "/list/entries", key: "path" }, children: ["folder", "file"] },
      // In action params json-render reads `$item` as the item's state path; `$template` gives its value.
      folder: { type: "Button", props: { label: { $template: "${name}/" }, variant: "secondary" }, visible: [{ $item: "kind", eq: "directory" }, { $item: "name", neq: ".trash" }], children: [],
        on: { press: [{ action: "setState", params: { statePath: "/dir", value: { $template: "${path}" } } }, setFile("")] } },
      file: { type: "Link", props: { label: { $item: "name" }, href: "#" }, visible: { $item: "kind", eq: "file" }, children: [], on: { press: setFile({ $template: "${path}" }) } },
      cut: { type: "Text", props: { text: "列表过长，只显示了一部分。", variant: "muted" }, visible: { $state: "/list/truncated", eq: true }, children: [] },
      viewer: { type: "Card", props: { title: { $state: "/file" } }, visible: { $state: "/file" }, children: ["binary", "long", "preview", "edit", "remove"] },
      binary: { type: "Alert", props: { title: "不是文本文件，不能在这里查看", type: "info" }, visible: { $state: "/doc/content", not: true }, children: [] },
      long: { type: "Alert", props: { title: "文档过长，只显示了开头，不能在这里修改", type: "warning" }, visible: { $state: "/doc/truncated", eq: true }, children: [] },
      preview: { type: "Markdown", props: { content: { $state: "/doc/content" } }, visible: { $state: "/doc/content" }, children: [] },
      edit: { type: "Collapsible", props: { title: "编辑" }, visible: { $state: "/doc/truncated", eq: false }, children: ["text", "save"] },
      text: { type: "Textarea", props: { label: "内容", name: "content", rows: 16, value: { $bindState: "/doc/content" } }, children: [] },
      save: { type: "Button", props: { label: "保存" }, children: [],
        on: { press: { action: "call", params: { tool: "write", args: { path: { $state: "/file" }, content: { $state: "/doc/content" } } } } } },
      remove: { type: "Button", props: { label: "移到回收站", variant: "secondary" }, children: [],
        on: { press: { action: "call", params: { tool: "delete", args: { path: { $state: "/file" } } }, confirm: { title: "移到回收站", message: "文件和它的历史会移到 .trash，之后可以恢复。", variant: "danger", confirmLabel: "移到回收站", cancelLabel: "取消" }, onSuccess: setFile("") } } },
    },
  },
};
