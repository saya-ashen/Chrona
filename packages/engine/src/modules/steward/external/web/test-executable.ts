import { strict as assert } from "node:assert";
import { loadExecutable } from "./src/executable-components";
import type { Page } from "./src/registered-page";

type Args = Record<string, unknown>;
type Caller = { kind: string; module: string; moduleId: string; hash: string };
type Request = (path: string, init?: RequestInit) => Promise<Response>;

/** The actual SDK tool -> persisted page -> HTTP -> browser loader contract. */
export async function checkExecutableComponents(
  tool: (id: string, args: Args, caller?: unknown) => Promise<unknown>,
  get: Request,
  post: (path: string, body: unknown) => Promise<Response>,
  owner: Caller,
  state: { status: string; activeHash: string | null },
) {
  const definition = { name: "NativePlayer", javascript: "export default function mount(element, context) { element.textContent = context.props.title; return () => element.replaceChildren(); }",
    css: "[data-native-player] { max-width: 100%; }", props: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }, events: ["change"], slots: [], tools: ["list"] };
  assert.match(JSON.stringify(await tool("component-set", definition, { ...owner, hash: "wrong" })), /版本|身份/);
  const registered = await tool("component-set", definition, owner) as { error?: string; result?: { result?: { name: string; type: string; revision: string } } };
  assert.equal(registered.error, undefined);
  const component = registered.result?.result;
  assert.ok(component); assert.equal(component.name, definition.name); assert.equal(component.type, `${owner.module}:NativePlayer`);
  const spec = { root: "player", elements: { player: { type: component.type, props: { title: "本地音频" }, children: [] } } };
  const saved = await tool("page-set", { id: "native-player", title: "原生播放器", spec }, owner) as { error?: string };
  assert.equal(saved.error, undefined);
  const path = `/api/web/pages/${owner.module}/native-player`;
  const response = await get(path); assert.equal(response.status, 200);
  const page = await response.json() as Page;
  const key = component.type, extension = page.extensions?.[key];
  assert.ok(extension, "SDK-registered executable type reaches the browser page metadata");
  assert.equal(extension.revision, component.revision);
  const componentPath = `/api/web/components/${owner.module}/NativePlayer?revision=${extension.revision}`;
  const resource = await get(componentPath);
  assert.equal(resource.status, 200); assert.equal(resource.headers.get("cache-control"), "private, no-store");
  const loaded = await loadExecutable(page, key, extension, {
    call: async () => null, navigate: () => {},
    content: async relative => { const result = await get(`/api/web${relative}`); assert.equal(result.status, 200); return result.blob(); },
  });
  assert.equal(loaded.javascript, definition.javascript); assert.equal(loaded.moduleId, owner.moduleId);
  const call = { target: `${owner.module}.list`, args: { path: "" }, page: { module: owner.module, id: page.id, revision: page.revision } };
  assert.equal((await post("/api/web/call", call)).status, 200, "declared component tools use the real page-pinned route");
  assert.equal((await post("/api/web/call", { ...call, page: { ...call.page, revision: "stale" } })).status, 409);
  assert.equal((await post("/api/web/call", { ...call, target: `${owner.module}.undeclared` })).status, 409);
  assert.equal((await post("/api/web/call", { ...call, target: "planning.get" })).status, 409);
  assert.equal((await get(componentPath.replace(extension.revision, "stale"))).status, 409);
  state.status = "paused";
  assert.equal((await get(componentPath)).status, 409); assert.equal((await post("/api/web/call", call)).status, 409);
  state.status = "active";
  const hash = state.activeHash; state.activeHash = "updated-version";
  assert.equal((await get(componentPath)).status, 409); assert.equal((await get(path)).status, 409);
  state.activeHash = hash;
  await tool("component-remove", { name: definition.name }, owner);
  assert.equal((await get(componentPath)).status, 404); assert.equal((await post("/api/web/call", call)).status, 409);
  await tool("page-remove", { id: "native-player" }, owner);
}
