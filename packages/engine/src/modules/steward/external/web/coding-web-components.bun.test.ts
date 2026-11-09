import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VisibilityConditionStrictSchema } from "@json-render/core";
import { expandComponents } from "./composition";
import { PageView, type Page } from "./src/pages";
import { PAGE } from "../coding-web/page";

const deps = { call: async () => ({}), content: async () => new Blob(), navigate: () => {} };

function questionPage(methods: string[]): Page {
  const spec = expandComponents(PAGE.spec, PAGE.components, "coding-web");
  spec.root = "questions";
  spec.state = {
    local: { answer: "保留的答复" }, command: { nextRequestKey: "answer-key" },
    detail: { questions: methods.map((method, i) => ({
      id: `q${i}`, title: `问题 ${i}`, help: "请选择答复方式", method,
      choices: [{ questionId: `q${i}`, label: `选项 ${i}` }],
    })) },
  };
  return { ...PAGE, module: "coding-web", data: {}, spec: spec as Page["spec"] };
}

test.each([
  ["confirm", true, false, false],
  ["select", false, true, false],
  ["input", false, false, true],
  ["editor", false, false, true],
] as const)("QuestionCard %s renders only its answer mode", (method, confirm, select, input) => {
  const page = questionPage([method]);
  const html = renderToStaticMarkup(createElement(PageView, { page, deps }));
  expect(html).toContain("问题 0");
  expect(html.includes(">是</button>")).toBe(confirm);
  expect(html.includes(">否</button>")).toBe(confirm);
  expect(html.includes("选项 0")).toBe(select);
  expect(html.includes('name="answer"')).toBe(input);
  expect(html.includes(">提交答复</button>")).toBe(input);
  if (input) expect(html).toContain(">保留的答复</textarea>");
  for (const element of Object.values(page.spec.elements)) {
    if (element.visible !== undefined) expect(VisibilityConditionStrictSchema.safeParse(element.visible).success).toBe(true);
  }
});

test("QuestionCard visibility keeps each repeated question's scope", () => {
  const page = questionPage(["select", "confirm", "editor"]);
  const html = renderToStaticMarkup(createElement(PageView, { page, deps }));
  expect(html.match(/>是<\/button>/g)).toHaveLength(1);
  expect(html.match(/>否<\/button>/g)).toHaveLength(1);
  expect(html).toContain("选项 0");
  expect(html).not.toContain("选项 1");
  expect(html).not.toContain("选项 2");
  expect(html.match(/name="answer"/g)).toHaveLength(1);
  expect(html.match(/>提交答复<\/button>/g)).toHaveLength(1);
});
