/// <reference types="bun" />
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageView, type Page } from "./pages";
import { expandComponents } from "../composition";
import { PAGE } from "../../../external/coding/page";

test.each([true, false])("a new default-project conversation renders send availability from canSend=%s", canSend => {
  const spec = expandComponents(PAGE.spec, PAGE.components, "coding");
  spec.state = { ...spec.state, detail: { sessionId: "", workId: "", project: "default-ref", projectLabel: "默认空间", projectPath: "/workspace", canSend, statusTone: "neutral" }, catalog: { projectGroups: [], selectedSession: "", notice: "" } };
  const page: Page = { ...PAGE, module: "coding", data: {}, spec: spec as Page["spec"] };
  const html = renderToStaticMarkup(<PageView page={page} deps={{ call: async () => ({}), content: async () => new Blob(), navigate: () => {} }} />);
  const send = /<button[^>]*>发送<\/button>/.exec(html)?.[0];
  expect(send).toBeDefined();
  expect(send!.includes('disabled=""')).toBe(!canSend);
  expect(html).toContain("从一个想法开始");
  expect(html).not.toContain('name="project"');
});
