import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectsInput, projectsOutput } from "@chrona/contracts/steward";
import type { CodingContext } from "./external/coding/types";

mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { handleCodingCommand } = await import("./external/coding/service");
const { loadSessions } = await import("./external/coding/sessions");
const fault = (code: string) => Object.assign(new Error(code), { code });

async function fixture(run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const f = await makeFixture(); try { await run(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "coding-project-policy-"));
  const calls: { caller: string; args: Record<string, unknown> }[] = [];
  const registries = new Map<string, { projectRef: string; path: string; label: string }[]>();
  function client(caller: string): CodingContext {
    const principal = { workspaceId: "fixture-workspace", ownerId: "owner", caller: { kind: "module", moduleId: caller, hash: `version-${caller}` } } as const;
    const projects = registries.get(caller) ?? [{ projectRef: `${caller}-repo`, path: `/fixture/${caller}`, label: `${caller} project` }];
    registries.set(caller, projects);
    const context: CodingContext = { dir: join(root, caller), content: join(root, caller, "public"), async call<T>(target: string, raw: Record<string, unknown>): Promise<T> {
      expect(target).toBe("agent.work-projects"); calls.push({ caller, args: structuredClone(raw) });
      // These are the actual Agent schemas: list is tagged, register takes only
      // path, create takes only name. Caller identity is supplied by routing.
      const parsed = projectsInput.safeParse(raw);
      if (!parsed.success) throw fault("invalid");
      const args = parsed.data;
      if (args.action === "list") return projectsOutput.parse({ action: "list", principal, projects }) as T;
      expect((await loadSessions(context)).commands.at(-1)?.receipt.status).toBe("pending");
      const item = { projectRef: `${caller}-project-${projects.length}`, path: args.action === "register" ? args.path! : `/fixture/created/${args.name}`, label: args.action === "create" ? args.name! : "Registered project" };
      projects.push(item);
      return projectsOutput.parse({ action: args.action, principal, project: item }) as T;
    } };
    return context;
  }
  const context = client("coding");
  const command = (raw: unknown, selected = context): Promise<any> => handleCodingCommand(selected, raw);
  return { root, context, command, client, calls, registries };
}

test("reading an empty registry never provisions a project or conversation", () => fixture(async f => {
  f.registries.get("coding")!.splice(0);
  expect(await f.command({ op: "projects.list" })).toEqual({ projects: [], defaultProjectRef: null });
  expect(await f.command({ op: "conversations.list" })).toEqual({ sessions: [], after: null });
  expect(f.calls).toEqual([{ caller: "coding", args: { action: "list" } }]);
  expect((await loadSessions(f.context)).sessions).toEqual([]);
  await expect(f.command({ op: "conversations.create", requestKey: "create", projectRef: "missing", title: "Missing project" })).rejects.toMatchObject({ code: "not_found" });
}));

test.each([
  { op: "projects.register", requestKey: "register", path: "/fixture/existing" },
  { op: "projects.create", requestKey: "create", name: "New-project" },
])("$op uses the real tagged Agent response and replays one durable receipt", raw => fixture(async f => {
  const first = await f.command(raw);
  expect(first.receipt.status).toBe("accepted");
  expect(first.receipt.value).toEqual({ projectRef: "coding-project-1", path: raw.op === "projects.register" ? "/fixture/existing" : "/fixture/created/New-project", label: raw.op === "projects.register" ? "Registered project" : "New-project" });
  expect(await f.command({ ...raw }, { ...f.context })).toEqual(first);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.args).toEqual(raw.op === "projects.register" ? { action: "register", path: raw.path } : { action: "create", name: raw.name });
  expect((await f.command({ op: "projects.list" })).projects).toContainEqual(first.receipt.value);
  expect((await f.command({ op: "receipt", requestKey: raw.requestKey })).receipt).toEqual(first.receipt);
  await expect(f.command({ ...raw, ...(raw.op === "projects.register" ? { path: "/fixture/different" } : { name: "Different" }) })).rejects.toMatchObject({ code: "conflict" });
}));

test("default preference is shared while existing conversations retain their project binding", () => fixture(async f => {
  f.registries.get("coding")!.push({ projectRef: "second-repo", path: "/fixture/second", label: "Second" });
  const create = { op: "conversations.create", requestKey: "conversation", projectRef: "coding-repo", title: "  Existing work  " };
  const first = await f.command(create);
  const change = { op: "projects.default", requestKey: "default", projectRef: "second-repo" };
  expect((await f.command(change)).receipt.value).toEqual({ defaultProjectRef: "second-repo" });
  expect((await f.command({ op: "projects.list" }, { ...f.context })).defaultProjectRef).toBe("second-repo");
  const session = (await f.command({ op: "conversations.get", sessionId: first.receipt.sessionId })).session;
  expect(session.projectRef).toBe("coding-repo"); expect(session.title).toBe("Existing work");
  expect(session.currentWorkId).toBeNull();
  expect((await f.command({ op: "conversations.list", projectRef: "second-repo" })).sessions).toEqual([]);
  expect((await f.command({ op: "conversations.list", projectRef: "coding-repo" })).sessions.map((item: { id: string }) => item.id)).toEqual([session.id]);
  expect(await f.command(create)).toEqual(first);
  await expect(f.command({ ...create, projectRef: "second-repo" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...change, requestKey: "foreign-default", projectRef: "foreign-repo" })).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls.every(call => call.args.action === "list")).toBe(true);
}));

test("Agent routing scopes project registries and module journals without caller or owner overrides", () => fixture(async f => {
  const peer = f.client("peer");
  expect((await f.command({ op: "projects.list" }, peer)).projects.map((item: { projectRef: string }) => item.projectRef)).toEqual(["peer-repo"]);
  await expect(f.command({ op: "conversations.create", requestKey: "foreign", projectRef: "coding-repo", title: "Other principal" }, peer)).rejects.toMatchObject({ code: "not_found" });
  const mine = await f.command({ op: "conversations.create", requestKey: "same-key", projectRef: "coding-repo", title: "Mine" });
  await expect(f.command({ op: "receipt", requestKey: "same-key" }, peer)).rejects.toMatchObject({ code: "not_found" });
  await expect(f.command({ op: "conversations.get", sessionId: mine.receipt.sessionId }, peer)).rejects.toMatchObject({ code: "not_found" });
  expect((await f.command({ op: "conversations.list" }, peer)).sessions).toEqual([]);
  const theirs = await f.command({ op: "conversations.create", requestKey: "same-key", projectRef: "peer-repo", title: "Theirs" }, peer);
  expect(theirs.receipt.value.projectRef).toBe("peer-repo");
  expect((await f.command({ op: "conversations.get", sessionId: mine.receipt.sessionId })).session.projectRef).toBe("coding-repo");
  expect(f.calls.every(call => Object.keys(call.args).every(key => ["action", "path", "name"].includes(key)))).toBe(true);
}));

test.each([
  { op: "projects.register", requestKey: "key", path: "/fixture/repo", name: "Not allowed" },
  { op: "projects.register", requestKey: "key", name: "Missing path" },
  { op: "projects.create", requestKey: "key", path: "/fixture/repo" },
  { op: "projects.create", requestKey: "key", name: "Name", path: "/fixture/repo" },
  { op: "projects.list", principal: { ownerId: "owner" } },
  { op: "projects.list", caller: "owner" },
  { op: "projects.list", workspaceId: "foreign" },
  { op: "projects.register", requestKey: "../escape", path: "/fixture/repo" },
  { op: "projects.register", requestKey: "key", path: "relative" },
  { op: "conversations.create", requestKey: "key", projectRef: "/host/path", title: "Path is not a ref" },
  { op: "conversations.create", requestKey: "key", projectRef: "coding-repo", title: "x".repeat(201) },
  { op: "conversations.list", limit: 101 },
])("invalid project or principal command is rejected before Agent dispatch: $op", raw => fixture(async f => {
  await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  expect(f.calls).toHaveLength(0);
}));

test("command byte limits and unknown operations are enforced before dispatch", () => fixture(async f => {
  for (const raw of [null, [], { op: "unsupported.operation" }, { op: "conversations.get", sessionId: "../escape" }, { op: "events", sessionId: "s", workId: "w", runId: "r", attemptId: "a", limit: 501 }]) {
    await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  }
  await expect(f.command({ op: "round.send", requestKey: "large", sessionId: "s", workId: null, text: "界".repeat(20000) })).rejects.toMatchObject({ code: "too_large" });
  expect(f.calls).toHaveLength(0);
}));
