/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageView, type Page } from "./pages";
import { components } from "../catalog";

function render(diff: unknown) {
  const page: Page = { module: "fixture", id: "generic", title: "通用页面", data: {}, spec: { root: "workspace", elements: {
    workspace: { type: "Workspace", props: { sidebarLabel: "记录", mainLabel: "详情" }, slots: { sidebar: ["sidebar"] }, children: ["scroll"] },
    sidebar: { type: "Text", props: { text: "最近记录" }, children: [] },
    scroll: { type: "ScrollArea", props: { label: "阅读记录", follow: true }, children: ["message"] },
    message: { type: "Message", props: { author: "助手", tone: "notice" }, children: ["diff", "option", "project", "draft"] },
    project: { type: "Select", props: { label: "项目", name: "project", value: "local-id", options: [{ value: "local-id", label: "已有目录" }, "legacy"] }, children: [] },
    draft: { type: "Textarea", props: { label: "消息", name: "draft", value: "", disabled: true }, children: [] },
    diff: { type: "CodeDiff", props: { filename: "src/example.ts", diff }, children: [] },
    option: { type: "ActionOption", props: { label: "继续", description: "保留当前选择", selected: true, disabled: true }, children: [] },
  } } };
  return renderToStaticMarkup(<PageView page={page} deps={{ call: async () => ({}), content: async () => new Blob(), navigate: () => {} }} />);
}

describe("shared workspace renderer", () => {
  test("generic spec composes named sidebar, scroll region, message and accessible option", () => {
    const html = render("");
    expect(html).toContain('<aside'); expect(html).toContain('aria-label="记录"');
    expect(html).toContain("最近记录"); expect(html).toContain('aria-label="阅读记录"');
    expect(html).toContain('<article'); expect(html).toContain('aria-label="助手"');
    expect(html).toContain('aria-pressed="true" disabled=""'); expect(html).toContain("保留当前选择");
    expect(html).toContain("暂无变更"); expect(html).not.toContain("还不能显示组件");
    expect(html).toContain('<option value="local-id" selected="">已有目录</option>');
    expect(html).toContain('<option value="legacy">legacy</option>');
    expect(html).toContain('<textarea name="draft" disabled=""');
  });

  test("workspace header, bound view tabs, panels and composer render through the shared registry", () => {
    const page: Page = { module: "fixture", id: "composed", title: "通用", data: {}, spec: { root: "workspace", state: { tab: "result", draft: "草稿" }, elements: {
      workspace: { type: "Workspace", props: { title: "工作区", description: "说明", breadcrumb: "项目 / 示例" }, children: ["header", "tabs", "panel", "composer"] },
      header: { type: "WorkspaceHeader", props: { title: "当前目标", status: "进行中", subtitle: "当前进展" }, children: [] },
      tabs: { type: "ViewTabs", props: { items: [{ value: "chat", label: "交流" }, { value: "result", label: "成果" }], value: { $bindState: "/tab" } }, children: [] },
      panel: { type: "Panel", props: { tone: "question" }, children: ["option"] },
      option: { type: "ActionOption", props: { label: "当前选择", compact: true, selected: true }, children: [] },
      composer: { type: "Composer", props: { hint: "补充到当前工作", footnote: "保留草稿" }, children: ["draft"], slots: { actions: ["send"] } },
      draft: { type: "Textarea", props: { label: "补充要求", name: "message", value: { $bindState: "/draft" } }, children: [] },
      send: { type: "Button", props: { label: "发送" }, children: [] },
    } } };
    const html = renderToStaticMarkup(<PageView page={page} deps={{ call: async () => ({}), content: async () => new Blob(), navigate: () => {} }} />);
    expect(html).toContain("项目 / 示例"); expect(html).toContain("说明");
    expect(html).toContain("<h1>当前目标</h1>"); expect(html).toContain("当前进展");
    expect(html).toContain('role="tab" aria-selected="true" tabindex="0">成果</button>');
    expect(html).toContain('<label><strong>补充要求 </strong><textarea');
    expect(html).toContain('name="message"'); expect(html).toContain('>草稿</textarea>');
    expect(html).toContain("补充到当前工作"); expect(html).toContain("保留草稿");
    expect(html).toContain('class="composer-actions"><button'); expect(html).toContain(">发送</button>");
    expect(html).not.toContain("还不能显示组件");
  });

  test.each([
    { statusTone: undefined, expected: "neutral" },
    { statusTone: "neutral", expected: "neutral" },
    { statusTone: "success", expected: "success" },
    { statusTone: "warning", expected: "warning" },
    { statusTone: "danger", expected: "danger" },
  ])("workspace status uses the declared tone $expected (input $statusTone)", ({ statusTone, expected }) => {
    const props = { title: "当前目标", status: "当前状态", statusTone };
    expect(components.WorkspaceHeader!.props.safeParse(props).success).toBe(true);
    const page: Page = { module: "fixture", id: "header", title: "状态", data: {}, spec: { root: "header", elements: {
      header: { type: "WorkspaceHeader", props, children: [] },
    } } };
    const html = renderToStaticMarkup(<PageView page={page} deps={{ call: async () => ({}), content: async () => new Blob(), navigate: () => {} }} />);
    expect(html).toContain(`class="workspace-status status-${expected}">当前状态</span>`);
  });

  test("catalog exposes the submit event and explicit keyboard disabled prop", () => {
    expect(components.Composer!.events).toEqual(["submit"]);
    expect(components.Composer!.props.safeParse({ disabled: true }).success).toBe(true);
    expect(components.Composer!.props.safeParse({ disabled: "true" }).success).toBe(false);
    expect(components.WorkspaceHeader!.props.safeParse({ title: "当前目标", statusTone: "green" }).success).toBe(false);
  });

  test("unresolved data shows an empty diff until the source loads", () => {
    const html = render({ $state: "/pending/diff" });
    expect(html).toContain("暂无变更"); expect(html).not.toContain("Something went wrong");
  });

  test("unified diff escapes code and counts actual changes across file and zero-length hunks", () => {
    const html = render("--- a/old.ts\n+++ b/new.ts\n@@ -1,1 +1,2 @@\n-<script>bad()</script>\n+<button>safe text</button>\n+++ literal content\ndiff --git a/empty.ts b/empty.ts\n--- /dev/null\n+++ b/empty.ts\n@@ -0,0 +1 @@\n+export {};\n");
    expect(html).toContain("新增 3 · 删除 1");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<button>safe text</button>");
    expect(html).toContain("+++ literal content"); expect(html).toContain("--- /dev/null");
    expect(html).toContain('tabindex="0"'); expect(html).toContain('aria-label="src/example.ts变更"');
  });
});
