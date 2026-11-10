import { describe, expect, test } from "bun:test";
import { loadExecutable } from "./executable-components";
import type { Deps, Page } from "./registered-page";

const page: Page = { module: "fixture", moduleId: "owner-id", hash: "approved-hash", id: "main", revision: "page-pin", title: "组件", data: {}, spec: { root: "root", elements: {} } };
const definition = { revision: "component-pin" };
const resource = { name: "AudioPlayer", module: "fixture", moduleId: "owner-id", hash: "approved-hash", revision: "component-pin", javascript: "export default () => () => {};", css: "audio { width: 100%; }" };
function deps(content: Deps["content"]): Deps {
  return { content, call: async () => { throw new Error("No calls expected"); }, navigate: () => {} };
}
describe("authenticated executable component loading", () => {
  test("loads the exact app-private component revision through existing content dependency", async () => {
    const paths: string[] = [];
    const result = await loadExecutable(page, "fixture:AudioPlayer", definition, deps(async path => { paths.push(path); return new Blob([JSON.stringify(resource)]); }));
    expect(paths).toEqual(["/components/fixture/AudioPlayer?revision=component-pin"]);
    expect(result).toEqual(resource);
  });
  test.each([
    ["owner", { moduleId: "another-owner" }],
    ["module", { module: "another-app" }],
    ["approved hash", { hash: "old-hash" }],
    ["revision", { revision: "old-revision" }],
    ["name", { name: "AnotherComponent" }],
    ["JavaScript", { javascript: null }],
    ["CSS", { css: 12 }],
  ])("rejects mismatched or invalid %s before executing source", async (_label, changed) => {
    await expect(loadExecutable(page, "fixture:AudioPlayer", definition, deps(async () => new Blob([JSON.stringify({ ...resource, ...changed })])))).rejects.toThrow("组件版本或内容无效");
  });
  test.each(["other:AudioPlayer", "fixture:../AudioPlayer", "fixture.AudioPlayer"])("rejects invalid extension name %s before requesting content", async name => {
    let requests = 0;
    await expect(loadExecutable(page, name, definition, deps(async () => { requests++; return new Blob(); }))).rejects.toThrow();
    expect(requests).toBe(0);
  });
});
