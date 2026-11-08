import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE } from "./external/coding/page";
import { pageErrors } from "./builtin/web/pages";
import { workbenchCatalog, workbenchCommand, workbenchDetail } from "./external/coding/workbench";
import type { CodingContext } from "./external/coding/types";
import type { ExecutionSnapshot, ExecutionView } from "./external/coding/contract.js";

test("coding page is accepted by the real shared renderer catalog", async () => {
  const manifest = JSON.parse(await readFile(join(import.meta.dirname, "external/coding/module.json"), "utf8"));
  const tools = new Map<string, { properties?: Record<string, unknown> }>(manifest.tools.map((tool: { name: string; parameters: object }) => [tool.name, tool.parameters]));
  expect(pageErrors(PAGE, tools, "coding")).toEqual([]);
  const web = JSON.parse(await readFile(join(import.meta.dirname, "builtin/web/module.json"), "utf8"));
  const allowed = Object.keys(web.tools.find((tool: { name: string }) => tool.name === "page-set").parameters.properties);
  expect(Object.keys(PAGE).every(key => allowed.includes(key))).toBe(true);
});

test("coding workbench preserves command identity, stop uncertainty and scoped results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coding-web-"));
  let starts = 0, writes = 0, answer: unknown;
  let view: ExecutionView = { workId: "web-one", sessionId: "s", runId: "r", attemptId: "a", projectRef: "repo", status: "running", cancelRequested: false, stopConfirmed: false };
  const snapshot: ExecutionSnapshot = { ...view, highWatermark: 1, finalMessage: null, questions: [], missing: false, expiresAt: "2026-12-01T00:00:00Z" };
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
    if (target === "agent.locations") return { locations: [{ kind: "server", online: true, projectRef: "repo" }, { kind: "device", online: true, projectRef: "remote" }], after: null } as T;
    if (target === "agent.run") {
      starts++;
      expect(args["execution-id"]).toBe("web-one");
      expect(args["request-key"]).toBe("web-one");
      expect(args.prompt).toContain("fix the fixture");
      return { execution: view } as T;
    }
    if (target === "agent.get") return { ...view } as T;
    if (target === "agent.inspect") return { snapshot: { ...snapshot, status: view.status, stopConfirmed: view.stopConfirmed, cancelRequested: view.cancelRequested }, source: { workId: view.workId, sessionId: "s", runId: "r", attemptId: "a", baseline: { kind: "commit", digest: "base" }, changes: { scope: "baseline_to_worktree", status: "complete", patch: "+fixed", files: [] } } } as T;
    if (target === "agent.stream") {
      expect(args["run-id"]).toBe("r"); expect(args["attempt-id"]).toBe("a");
      return { events: [{ seq: 1, payload: { type: "message", text: "正在检查文件", messageId: "progress", truncated: false } }], gap: false, snapshotRequired: false } as T;
    }
    if (target === "agent.write") { writes++; expect(args.text).toBe("add a check"); return { accepted: true } as T; }
    if (target === "agent.respond") { answer = JSON.parse(String(args.answer)); return { accepted: true } as T; }
    if (target === "agent.interrupt") { view.cancelRequested = true; return { ...view } as T; }
    throw new Error(`Unexpected target ${target}`);
  } };
  try {
    expect((await workbenchCatalog(context)).projects).toEqual(["repo"]);
    const create = { action: "create", "request-key": "one", project: "repo", text: "fix the fixture" };
    expect((await workbenchCommand(context, create)).workId).toBe("web-one");
    await workbenchCommand({ ...context }, create);
    expect(starts).toBe(1);
    const unavailable: CodingContext = { ...context, async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
      if (target === "agent.locations") throw Object.assign(new Error("placements unavailable"), { code: "unavailable" });
      return context.call<T>(target, args);
    } };
    const catalog = await workbenchCatalog(unavailable);
    expect(catalog.configured).toBe(false);
    expect(catalog.notice).toContain("配置");
    expect(catalog.workIds).toEqual(["web-one"]);
    await expect(workbenchCommand(context, { ...create, text: "changed" })).rejects.toMatchObject({ code: "conflict" });
    await expect(workbenchCommand(context, { ...create, cwd: "/host" })).rejects.toMatchObject({ code: "invalid" });
    await expect(workbenchDetail(context, "../sessions/index")).rejects.toMatchObject({ code: "invalid" });
    await expect(workbenchDetail(context, "foreign")).rejects.toMatchObject({ code: "not_found" });
    await workbenchCommand(context, { action: "send", "request-key": "send", "work-id": view.workId, text: "add a check" });
    expect(writes).toBe(1);
    snapshot.questions = [{ requestId: "question", title: "允许修改？", method: "confirm", options: [], status: "pending", expiresAt: "2026-12-01T00:00:00Z" }];
    await workbenchCommand(context, { action: "answer", "request-key": "answer", "work-id": view.workId, question: "question", text: "是" });
    expect(answer).toEqual({ decision: "submit", value: true });
    const stopping = await workbenchCommand(context, { action: "stop", "request-key": "stop", "work-id": view.workId });
    expect(stopping.hasQuestions).toBe(true);
    expect(stopping.stop).toContain("尚未确认");
    expect(stopping.canSend).toBe(false);
    view = { ...view, status: "completed", stopConfirmed: true };
    snapshot.questions = [];
    snapshot.finalMessage = { messageId: "final", text: "已修复并执行检查。", truncated: false };
    const done = await workbenchDetail(context, view.workId);
    expect(done.hasQuestions).toBe(false);
    expect(done.output).toBe("已修复并执行检查。"); expect(done.patch).toBe("+fixed");
    expect(done.progress[0]!.text).toBe("正在检查文件");
    await workbenchCommand(context, { action: "accept", "request-key": "accept", "work-id": view.workId, result: done.resultIds[0] });
    expect((await workbenchDetail(context, view.workId)).resultIds).toEqual([]);
    expect(starts).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
