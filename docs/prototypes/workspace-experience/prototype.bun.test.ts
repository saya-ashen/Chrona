import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("./prototype.js", import.meta.url), "utf8");

function prototype() {
  const elements = new Map<string, { innerHTML: string; addEventListener: () => void }>();
  const context = createContext({
    document: {
      title: "",
      querySelector(selector: string) {
        if (!elements.has(selector)) elements.set(selector, { innerHTML: "", addEventListener() {} });
        return elements.get(selector);
      },
      addEventListener() {},
    },
    location: { hash: "#overview" },
    window: { addEventListener() {} },
  });
  runInContext(source, context);
  return (code: string) => runInContext(code, context) as unknown;
}

describe("offline workspace prototype rendering", () => {
  it("escapes a work identity before inserting it into navigation attributes", () => {
    const evaluate = prototype();
    const id = 'local-" onmouseover="alert(1)';
    const html = evaluate(`
      state.extra.push({ id: ${JSON.stringify(id)}, title: 'Safe title', kind: 'Note', context: '', symbol: '+', group: 'continue' });
      workDetail(${JSON.stringify(id)}, false);
    `);
    expect(html).toBeString();
    expect(html).toContain('href="#work/local-&quot; onmouseover=&quot;alert(1)"');
    expect(html).toContain('href="#work/local-&quot; onmouseover=&quot;alert(1)/history"');
    expect(html).not.toContain('href="#work/local-" onmouseover="');
  });

  it("does not reflect unknown hash identities into the page", () => {
    const evaluate = prototype();
    expect(evaluate('workDetail(\'<img src=x onerror=alert(1)>\', false)')).not.toContain("<img");
  });

  it("keeps absent feedback distinct from exact-version feedback and later versions", () => {
    const evaluate = prototype();
    expect(evaluate("reportContent()")).toContain("第 2 版可以使用了吗？");
    expect(evaluate("state.feedbackVersion = 2; state.feedback = '<img src=x onerror=alert(1)>'; reportContent()")).toContain("第 2 版已有修改意见");
    expect(evaluate("reportContent()")).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(evaluate("description('report').tag")).toBe("待交接");
    expect(evaluate("state.latest = 3; state.selected = 3; reportContent()")).toContain("第 3 版可以使用了吗？");
    expect(evaluate("description('report').tag")).toBe("有新成果");
  });
});
