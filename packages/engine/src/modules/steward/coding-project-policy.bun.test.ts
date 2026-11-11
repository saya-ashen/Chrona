import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingContext } from "./external/coding/types";

mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { handleCodingCommand } = await import("./external/coding/service");
const { loadSessions } = await import("./external/coding/sessions");

async function fixture(run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const f = await makeFixture(); try { await run(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "coding-project-policy-"));
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  function client(owner: string): CodingContext {
    return { dir: join(root, owner), content: join(root, owner, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ target, args: structuredClone(args) });
      throw new Error(`Project configuration must remain in Coding: unexpected ${target}`);
    } };
  }
  const context = client("coding");
  const command = (raw: unknown, selected = context): Promise<any> => handleCodingCommand(selected, raw);
  async function register(name: string, selected = context) {
    const path = join(root, `repo-${name}`); await mkdir(path);
    return (await command({ op: "projects.register", requestKey: `register-${name}`, path }, selected)).receipt.value as { projectRef: string; path: string; label: string };
  }
  return { root, context, command, client, calls, register };
}

test("reading an empty registry never provisions a project or conversation", () => fixture(async f => {
  expect(await f.command({ op: "projects.list" })).toEqual({ projects: [], defaultProjectRef: null });
  expect(await f.command({ op: "conversations.list" })).toEqual({ sessions: [], after: null });
  expect(f.calls).toEqual([]);
  await expect(readFile(join(f.context.dir, "sessions", "projects.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await loadSessions(f.context)).sessions).toEqual([]);
  await expect(f.command({ op: "conversations.create", requestKey: "create", projectRef: "missing", title: "Missing project" })).rejects.toMatchObject({ code: "not_found" });
}));

test("register persists a Coding-owned canonical directory and replays one durable receipt", () => fixture(async f => {
  const path = join(f.root, "existing"); await mkdir(path);
  const raw = { op: "projects.register", requestKey: "register", path };
  const first = await f.command(raw);
  expect(first.receipt.status).toBe("accepted");
  expect(first.receipt.value).toMatchObject({ path, label: "existing" });
  expect(first.receipt.value.projectRef).toMatch(/^project-[a-f0-9]{64}$/);
  expect(await f.command({ ...raw }, { ...f.context })).toEqual(first);
  const alias = join(f.root, "alias"); await symlink(path, alias);
  expect((await f.command({ ...raw, requestKey: "alias", path: alias })).receipt.value).toEqual(first.receipt.value);
  expect((await f.command({ op: "projects.list" })).projects).toEqual([first.receipt.value]);
  expect(JSON.parse(await readFile(join(f.context.dir, "sessions", "projects.json"), "utf8"))).toEqual([{ ...first.receipt.value, identity: expect.stringMatching(/^\d+:\d+$/) }]);
  expect((await f.command({ op: "receipt", requestKey: "register" })).receipt).toEqual(first.receipt);
  await expect(f.command({ ...raw, path: join(f.root, "different") })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls).toHaveLength(0);
}));

async function restartCommand(context: CodingContext, command: unknown) {
  const entry = new URL("./external/coding/service.ts", import.meta.url).href;
  const script = `import { mock } from "bun:test";
    mock.module("chrona", () => ({ ModelError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));
    const { handleCodingCommand } = await import(${JSON.stringify(entry)});
    const context = JSON.parse(process.argv[1]);
    context.call = async () => { throw new Error("Project creation must not invoke Agent"); };
    console.log(JSON.stringify(await handleCodingCommand(context, JSON.parse(process.argv[2]))));`;
  const child = Bun.spawn([process.execPath, "--eval", script, JSON.stringify({ dir: context.dir, content: context.content }), JSON.stringify(command)], { stdout: "pipe", stderr: "pipe" });
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ error, exit }).toEqual({ error: "", exit: 0 });
  return JSON.parse(output);
}

test("create provisions a private ordinary directory once, persists identity and replays after real process restart", () => fixture(async f => {
  const raw = { op: "projects.create", requestKey: "create", name: "New-project" };
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => f.command({ ...raw, requestKey: `create-${index}` })));
  const first = results[0], project = first.receipt.value, path = join(f.context.dir, "managed-projects", raw.name);
  expect(first.receipt.status).toBe("accepted");
  expect(results.every(result => JSON.stringify(result.receipt.value) === JSON.stringify(project))).toBe(true);
  expect(project).toEqual({ projectRef: expect.stringMatching(/^project-[a-f0-9]{64}$/), path, label: raw.name });
  expect((await stat(path)).isDirectory()).toBe(true);
  expect((await stat(path)).mode & 0o777).toBe(0o700);
  expect((await stat(join(f.context.dir, "managed-projects"))).mode & 0o777).toBe(0o700);
  expect(await readdir(path)).toEqual([]); // An ordinary project does not initialize Git.
  await writeFile(join(path, "notes.txt"), "keep across restart");
  expect(await restartCommand(f.context, { ...raw, requestKey: "create-0" })).toEqual(first);
  expect((await restartCommand(f.context, raw)).receipt.value).toEqual(project);
  expect((await f.command({ op: "projects.register", requestKey: "register-created", path })).receipt.value).toEqual(project);
  expect((await f.command({ op: "projects.list" })).projects).toEqual([project]);
  expect(await readFile(join(path, "notes.txt"), "utf8")).toBe("keep across restart");
  expect((await f.command({ op: "receipt", requestKey: "create-0" })).receipt).toEqual(first.receipt);
  await expect(f.command({ ...raw, requestKey: "create-0", name: "Different" })).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls).toHaveLength(0);
}));

test("a persisted project survives a lost acceptance response without creating another directory", () => fixture(async f => {
  const raw = { op: "projects.create", requestKey: "lost-response", name: "Saved" };
  const accepted = await f.command(raw), file = join(f.context.dir, "sessions", "index.json");
  // Model a crash after registry fsync, before the acceptance journal replacement.
  const journal = JSON.parse(await readFile(file, "utf8"));
  journal.commands[0].receipt = { requestKey: raw.requestKey, op: raw.op, status: "pending" };
  await writeFile(file, JSON.stringify(journal));
  expect((await restartCommand(f.context, raw)).receipt.status).toBe("pending");
  expect((await restartCommand(f.context, { ...raw, requestKey: "same-name" })).receipt.value).toEqual(accepted.receipt.value);
  expect(await readdir(join(f.context.dir, "managed-projects"))).toEqual([raw.name]);
  expect((await f.command({ op: "projects.list" })).projects).toEqual([accepted.receipt.value]);
}));

test.each(["root", "project"])("create rejects a symlink at managed %s without touching its target", level => fixture(async f => {
  const raw = { op: "projects.create", requestKey: "first", name: "First" };
  const first = (await f.command(raw)).receipt.value;
  const target = join(f.root, "outside"); await mkdir(target);
  const path = level === "root" ? join(f.context.dir, "managed-projects") : join(f.context.dir, "managed-projects", "Second");
  if (level !== "project") await rename(path, `${path}-old`);
  await symlink(target, path);
  const outcome = await f.command({ ...raw, requestKey: "second", name: "Second" });
  expect(outcome.receipt).toMatchObject({ status: "pending", error: { code: "conflict" } });
  expect(await readdir(target)).toEqual([]);
  expect((await f.command({ op: "projects.list" })).projects).toEqual([first]);
}));

test("same-name creation refuses replaced, missing and symlinked directories", () => fixture(async f => {
  const raw = { op: "projects.create", requestKey: "first", name: "First" };
  const project = (await f.command(raw)).receipt.value;
  await rename(project.path, `${project.path}-original`); await mkdir(project.path);
  expect((await f.command({ ...raw, requestKey: "replacement" })).receipt).toMatchObject({ status: "pending", error: { code: "conflict" } });
  await rm(project.path, { recursive: true });
  expect((await f.command({ ...raw, requestKey: "missing" })).receipt).toMatchObject({ status: "pending", error: { code: "conflict" } });
  await symlink(`${project.path}-original`, project.path);
  expect((await f.command({ ...raw, requestKey: "symlink" })).receipt).toMatchObject({ status: "pending", error: { code: "conflict" } });
  expect((await f.command({ op: "projects.list" })).projects).toEqual([project]);
  expect(f.calls).toEqual([]);
}));

test("register and create share the 100-project bound; existing names still resolve at capacity", () => fixture(async f => {
  const registered = await f.register("first");
  const first = (await f.command({ op: "projects.create", requestKey: "create", name: "First" })).receipt.value;
  for (let index = 0; index < 98; index++) await f.command({ op: "projects.create", requestKey: `fill-${index}`, name: `Project-${index}` });
  const full = { op: "projects.create", requestKey: "full", name: "Overflow" };
  await expect(f.command(full)).rejects.toMatchObject({ code: "capacity" });
  expect((await f.command(full)).receipt).toMatchObject({ status: "rejected", error: { code: "capacity" } });
  await expect(stat(join(f.context.dir, "managed-projects", "Overflow"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.command({ op: "projects.create", requestKey: "again", name: "First" })).receipt.value).toEqual(first);
  expect((await f.command({ op: "projects.register", requestKey: "reregister", path: registered.path })).receipt.value).toEqual(registered);
  const path = join(f.root, "extra"); await mkdir(path);
  await expect(f.command({ op: "projects.register", requestKey: "extra", path })).rejects.toMatchObject({ code: "capacity" });
  expect((await f.command({ op: "projects.list" })).projects).toHaveLength(100);
  expect(f.calls).toEqual([]);
}));

test("maximum length names create successfully and managed projects remain private to each Coding storage root", () => fixture(async f => {
  const name = `A${"b".repeat(63)}`, raw = { op: "projects.create", requestKey: "create", name };
  const mine = (await f.command(raw)).receipt.value, isolated = f.client("isolated");
  const other = (await f.command(raw, isolated)).receipt.value;
  expect(mine.path).toBe(join(f.context.dir, "managed-projects", name));
  expect(other.path).toBe(join(isolated.dir, "managed-projects", name));
  expect(other.projectRef).not.toBe(mine.projectRef);
  expect((await f.command({ op: "projects.list" }, isolated)).projects).toEqual([other]);
  expect(f.calls).toEqual([]);
}));

test("only existing directories can be registered and definitive failures retain their receipts", () => fixture(async f => {
  const file = join(f.root, "regular-file"); await writeFile(file, "not a directory");
  for (const [index, path] of [join(f.root, "missing"), file].entries()) {
    const raw = { op: "projects.register", requestKey: `invalid-${index}`, path };
    await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
    expect((await f.command(raw)).receipt.status).toBe("rejected");
  }
  expect((await f.command({ op: "projects.list" })).projects).toEqual([]); expect(f.calls).toHaveLength(0);
}));

test("default preference is shared while existing conversations retain their project binding", () => fixture(async f => {
  const firstProject = await f.register("first"), secondProject = await f.register("second");
  const create = { op: "conversations.create", requestKey: "conversation", projectRef: firstProject.projectRef, title: "  Existing work  " };
  const first = await f.command(create);
  const change = { op: "projects.default", requestKey: "default", projectRef: secondProject.projectRef };
  const changed = await f.command(change);
  expect(changed.receipt.value).toEqual({ defaultProjectRef: secondProject.projectRef });
  expect(await f.command(change, { ...f.context })).toEqual(changed);
  await expect(f.command({ ...change, projectRef: firstProject.projectRef })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.command({ op: "projects.list" }, { ...f.context })).defaultProjectRef).toBe(secondProject.projectRef);
  const session = (await f.command({ op: "conversations.get", sessionId: first.receipt.sessionId })).session;
  expect(session.projectRef).toBe(firstProject.projectRef); expect(session.title).toBe("Existing work");
  expect(session.currentWorkId).toBeNull();
  expect((await f.command({ op: "conversations.list", projectRef: secondProject.projectRef })).sessions).toEqual([]);
  expect((await f.command({ op: "conversations.list", projectRef: firstProject.projectRef })).sessions.map((item: { id: string }) => item.id)).toEqual([session.id]);
  expect(await f.command(create)).toEqual(first);
  await expect(f.command({ ...create, projectRef: secondProject.projectRef })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.command({ ...change, requestKey: "foreign-default", projectRef: "foreign-repo" })).rejects.toMatchObject({ code: "not_found" });
  const selected = await f.command({ op: "conversations.create", requestKey: "selected", projectRef: secondProject.projectRef, title: "Selected project" });
  expect(selected.receipt.value.projectRef).toBe(secondProject.projectRef);
  expect((await loadSessions(f.context)).defaultProjectRef).toBe(secondProject.projectRef);
  expect(f.calls).toHaveLength(0);
}));

test("Coding storage scopes registries and journals while peer interfaces share the same service state", () => fixture(async f => {
  const peer = { ...f.context }, isolated = f.client("isolated");
  const mineProject = await f.register("mine"), otherProject = await f.register("other", isolated);
  expect((await f.command({ op: "projects.list" }, peer)).projects).toEqual([mineProject]);
  expect((await f.command({ op: "projects.list" }, isolated)).projects).toEqual([otherProject]);
  await expect(f.command({ op: "conversations.create", requestKey: "foreign", projectRef: mineProject.projectRef, title: "Other service" }, isolated)).rejects.toMatchObject({ code: "not_found" });
  const mine = await f.command({ op: "conversations.create", requestKey: "same-key", projectRef: mineProject.projectRef, title: "Mine" });
  expect((await f.command({ op: "receipt", requestKey: "same-key" }, peer)).receipt).toEqual(mine.receipt);
  await expect(f.command({ op: "receipt", requestKey: "same-key" }, isolated)).rejects.toMatchObject({ code: "not_found" });
  await expect(f.command({ op: "conversations.get", sessionId: mine.receipt.sessionId }, isolated)).rejects.toMatchObject({ code: "not_found" });
  expect((await f.command({ op: "conversations.list" }, isolated)).sessions).toEqual([]);
  const theirs = await f.command({ op: "conversations.create", requestKey: "same-key", projectRef: otherProject.projectRef, title: "Theirs" }, isolated);
  expect(theirs.receipt.value.projectRef).toBe(otherProject.projectRef);
  expect((await f.command({ op: "conversations.get", sessionId: mine.receipt.sessionId }, peer)).session.projectRef).toBe(mineProject.projectRef);
  expect(f.calls).toHaveLength(0);
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
])("invalid project or principal command is rejected before dispatch: $op", raw => fixture(async f => {
  await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  expect(f.calls).toHaveLength(0);
}));

test.each(["", ".", "..", "../escape", "/absolute", "nested/name", "a\\b", "a b", "_start", "a".repeat(65)])("unsafe project name is rejected before managed filesystem effects: %s", name => fixture(async f => {
  await expect(f.command({ op: "projects.create", requestKey: "invalid", name })).rejects.toMatchObject({ code: "invalid" });
  await expect(stat(f.context.dir)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls).toEqual([]);
}));

test("command byte limits and unknown operations are enforced before dispatch", () => fixture(async f => {
  for (const raw of [null, [], { op: "unsupported.operation" }, { op: "conversations.get", sessionId: "../escape" }, { op: "events", sessionId: "s", workId: "w", runId: "r", attemptId: "a", limit: 501 }]) {
    await expect(f.command(raw)).rejects.toMatchObject({ code: "invalid" });
  }
  await expect(f.command({ op: "round.send", requestKey: "large", sessionId: "s", workId: null, text: "界".repeat(20000) })).rejects.toMatchObject({ code: "too_large" });
  expect(f.calls).toHaveLength(0);
}));
