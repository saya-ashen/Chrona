import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Workspace, WorkspaceHeader, ViewTabs, Composer, ScrollArea, Message, CodeDiff, ActionOption } from "./workspace";
const noop = () => {};
test("shared React workspace composes accessible sidebar, message, tabs and composer", () => {
  const html = renderToStaticMarkup(<Workspace sidebarLabel="记录" mainLabel="详情" sidebar={<p>最近记录</p>}>
    <WorkspaceHeader title="当前目标" status="进行中" statusTone="success" />
    <ViewTabs items={[{ value: "chat", label: "交流" }, { value: "result", label: "成果" }]} value="result" />
    <ScrollArea label="阅读记录"><Message author="助手"><ActionOption label="继续" selected disabled /></Message></ScrollArea>
    <Composer onSubmit={noop} hint="补充到当前工作" actions={<button>发送</button>}><textarea aria-label="补充要求" defaultValue="草稿" /></Composer>
  </Workspace>);
  for (const text of ['aria-label="记录"', 'aria-label="阅读记录"', 'aria-label="助手"', "最近记录", "当前目标", 'status-success', 'aria-selected="true"', 'aria-pressed="true"', "草稿", "发送"]) expect(html).toContain(text);
});
test("unified diff escapes code and counts changes across files and zero-length hunks", () => {
  const html = renderToStaticMarkup(<CodeDiff filename="src/example.ts" diff={'--- a/old.ts\n+++ b/new.ts\n@@ -1,1 +1,2 @@\n-<script>bad()</script>\n+<button>safe text</button>\n+++ literal content\ndiff --git a/empty.ts b/empty.ts\n--- /dev/null\n+++ b/empty.ts\n@@ -0,0 +1 @@\n+export {};\n'} />);
  expect(html).toContain("新增 3 · 删除 1"); expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain('aria-label="src/example.ts变更"');
  expect(renderToStaticMarkup(<CodeDiff diff="" />)).toContain("暂无变更");
});
