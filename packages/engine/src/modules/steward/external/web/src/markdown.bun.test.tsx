import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./ui";

test("shared Markdown preserves headings, tasks, lists, code and safe inline formatting", () => {
  const html = renderToStaticMarkup(<Markdown content={'# 标题\n- 第一项\n- [x] 已完成\n\n```ts\n<script>alert(1)</script>\n```\n**强调** `代码` [本地](/files)\n[危险](javascript:alert) [远程](//example.com)'} />);
  expect(html).toContain("<h3>标题</h3>");
  expect(html).toContain("<li>第一项</li>");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("checked");
  expect(html).toContain("<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>");
  expect(html).toContain("<strong>强调</strong>");
  expect(html).toContain("<code>代码</code>");
  expect(html).toContain('href="/files"');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="//');
});
