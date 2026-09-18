import { expect, test } from "bun:test";
import { exampleWorkPage } from "./example";
import { workPageSchema, validatePageAnswers, calculatePageMetric } from "./schema";
import { describeWorkPageCatalog } from "./index";

test("literal page catalog exports bounded machine schema and valid composition", () => {
  expect(workPageSchema.safeParse(exampleWorkPage).success).toBe(true);
  expect(JSON.stringify(describeWorkPageCatalog()).length).toBeLessThan(96 * 1024);
  expect(calculatePageMetric(exampleWorkPage.datasets.parts, "sum", "price")).toBe(9260);
  expect(calculatePageMetric(exampleWorkPage.datasets.parts, "count")).toBe(3);
});
for (const [name, mutate] of Object.entries<Record<string, (page: any) => void>[string]>({
  cycle: (p) => p.elements.page.children.push("page"),
  orphan: (p) => p.elements.orphan = { type: "Text", props: { text: "hidden" } },
  action: (p) => p.elements.decision.on = { submit: { action: "accept-plan" } },
  expression: (p) => p.elements.summary.props.text = { $state: "/secret" },
  html: (p) => p.elements.summary.type = "HTML",
  url: (p) => p.elements.reference.props.href = "javascript:alert(1)",
  credentials: (p) => p.elements.reference.props.href = "https://u:password@example.com",
  remote: (p) => p.datasets.parts.url = "https://example.com",
  metric: (p) => p.elements.total.props.column = "part",
  missing: (p) => p.elements.decision.props.form = "missing",
  condition: (p) => p.forms.decision.fields[0].when = { field: "thoughts", equals: "yes" },
  field: (p) => p.forms.decision.fields.push(p.forms.decision.fields[0]),
})) test(`rejects ${name}`, () => { const p = structuredClone(exampleWorkPage); mutate(p); expect(workPageSchema.safeParse(p).success).toBe(false); });

test("answers validate exact field types, visibility and calendar dates without side effects", () => {
  const form = exampleWorkPage.forms.decision;
  expect(validatePageAnswers(form, { timing: "now", date: "2026-02-30", thoughts: "ok" })).toEqual({ answers: { timing: "now", thoughts: "ok" }, errors: {} });
  expect(validatePageAnswers(form, { timing: "wait", date: "2026-02-30" }).errors.date).toBe("invalid");
  expect(validatePageAnswers(form, { timing: "buy", budget: -1 }).errors).toEqual({ timing: "invalid", budget: "invalid" });
  expect(validatePageAnswers(form, { secret: "x" }).errors).toEqual({ _form: "unknown_field", timing: "required" });
  expect(validatePageAnswers(form, { timing: "undecided", thoughts: "<script>not executable</script>" }).errors).toEqual({});
});
