import { describe, expect, it } from "bun:test";
import { buildResultSpec } from "./build-result-spec";
import { validateChronaSpec } from "../document/validate";

describe("buildResultSpec", () => {
  it("produces an empty Stack for an empty outputs array", () => {
    const doc = buildResultSpec([]);
    expect(doc.root).toBe("root");
    expect(doc.elements.root.type).toBe("Stack");
    expect(doc.elements.root.children).toEqual([]);
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("renders a Text placeholder when emptyMessage is set and outputs is empty", () => {
    const doc = buildResultSpec([], { emptyMessage: "No result yet." });
    expect(doc.elements["empty-state"].type).toBe("Text");
    expect((doc.elements["empty-state"].props as Record<string, unknown>).text).toBe("No result yet.");
    expect(doc.elements.root.children).toEqual(["empty-state"]);
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("renders an error Alert when errorMessage is set and outputs is empty", () => {
    const doc = buildResultSpec([], { errorMessage: "Run failed: timeout" });
    expect(doc.elements["empty-state"].type).toBe("Alert");
    const props = doc.elements["empty-state"].props as Record<string, unknown>;
    expect(props.title).toBe("Run failed: timeout");
    expect(props.type).toBe("error");
    expect(doc.elements.root.children).toEqual(["empty-state"]);
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("errorMessage takes precedence over emptyMessage when both are set", () => {
    const doc = buildResultSpec([], { emptyMessage: "placeholder", errorMessage: "fatal error" });
    expect(doc.elements["empty-state"].type).toBe("Alert");
    expect((doc.elements["empty-state"].props as Record<string, unknown>).title).toBe("fatal error");
  });

  it("ignores options when outputs is non-empty", () => {
    const doc = buildResultSpec(
      [{ kind: "markdown", content: "done" }],
      { emptyMessage: "should not appear" },
    );
    expect(doc.elements["empty-state"]).toBeUndefined();
    expect(doc.elements.root.children).toHaveLength(1);
  });

  it("maps a markdown output to a Markdown element", () => {
    const doc = buildResultSpec([{ kind: "markdown", content: "# Hello", title: "Summary" }]);
    const key = Object.keys(doc.elements).find((k) => k.startsWith("out:0:markdown"))!;
    expect(doc.elements[key].type).toBe("Markdown");
    expect((doc.elements[key].props as Record<string, unknown>).content).toBe("# Hello");
    expect((doc.elements[key].props as Record<string, unknown>).title).toBe("Summary");
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("maps a json output to a JsonView element", () => {
    const value = { answer: 42 };
    const doc = buildResultSpec([{ kind: "json", value, title: "Result JSON" }]);
    const key = Object.keys(doc.elements).find((k) => k.startsWith("out:0:json"))!;
    expect(doc.elements[key].type).toBe("JsonView");
    expect((doc.elements[key].props as Record<string, unknown>).value).toEqual(value);
    expect((doc.elements[key].props as Record<string, unknown>).title).toBe("Result JSON");
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("maps a file output to a FileRef element", () => {
    const doc = buildResultSpec([{ kind: "file", path: "/tmp/out.ts", language: "typescript", description: "Generated file", title: "Output" }]);
    const key = Object.keys(doc.elements).find((k) => k.startsWith("out:0:file"))!;
    expect(doc.elements[key].type).toBe("FileRef");
    const props = doc.elements[key].props as Record<string, unknown>;
    expect(props.path).toBe("/tmp/out.ts");
    expect(props.language).toBe("typescript");
    expect(props.description).toBe("Generated file");
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("maps a link output to a Link element", () => {
    const doc = buildResultSpec([{ kind: "link", href: "https://example.com", title: "View output" }]);
    const key = Object.keys(doc.elements).find((k) => k.startsWith("out:0:link"))!;
    expect(doc.elements[key].type).toBe("Link");
    const props = doc.elements[key].props as Record<string, unknown>;
    expect(props.href).toBe("https://example.com");
    expect(props.label).toBe("View output");
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });

  it("maps mixed outputs in order and each validates", () => {
    const doc = buildResultSpec([
      { kind: "markdown", content: "Done." },
      { kind: "file", path: "/out/result.json" },
      { kind: "link", href: "https://chrona.dev", title: "Chrona" },
    ]);
    const rootChildren = doc.elements.root.children ?? [];
    expect(rootChildren).toHaveLength(3);
    expect(doc.elements[rootChildren[0]].type).toBe("Markdown");
    expect(doc.elements[rootChildren[1]].type).toBe("FileRef");
    expect(doc.elements[rootChildren[2]].type).toBe("Link");
    const result = validateChronaSpec(doc);
    expect(result.ok).toBe(true);
  });
});
