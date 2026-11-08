/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageView, type Page } from "./pages";

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
