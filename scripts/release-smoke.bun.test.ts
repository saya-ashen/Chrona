import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildArtifacts } from "../build/manifest";
import { approveSmokeWeb, assertModuleTypecheck, assertPiReleaseResources, releaseSmokeEnvironment } from "../build/release-smoke";

test("release smoke uses isolated credentials and disables real providers", () => {
  const env = releaseSmokeEnvironment("/tmp/smoke/data", "/tmp/smoke/config", {
    API_KEY: "inherited-test-key",
    CHRONA_CONFIG_FILE: "/must-not-read/config.json",
    CHRONA_STEWARD_AGENT: "pi",
    CHRONA_QQ_APP_ID: "inherited-app",
    CHRONA_QQ_SECRET_FILE: "/must-not-read",
    CHRONA_RESOURCE_DIR: "/must-not-use-source-resources",
    CHRONA_PACKAGE_DIR: "/must-not-use-source-package",
    CHRONA_MIGRATIONS_DIR: "/must-not-use-source-migrations",
    CHRONA_PROCESS_HELPER: "/must-not-use-source-guardian",
    CHRONA_SDK: "/must-not-use-source-sdk",
  });
  expect(env.CHRONA_CONFIG_FILE).toBe("/tmp/smoke/config/config.json");
  expect(env.API_KEY).toBeTruthy();
  expect(env.API_KEY).not.toBe("inherited-test-key");
  expect(env.CHRONA_STEWARD_AGENT).toBe("");
  expect(env.CHRONA_QQ_APP_ID).toBe("");
  expect(env.CHRONA_QQ_SECRET_FILE).toBe("");
  expect(env.DATABASE_URL).toBe("file:/tmp/smoke/data/chrona.db");
  for (const name of ["CHRONA_RESOURCE_DIR", "CHRONA_PACKAGE_DIR", "CHRONA_MIGRATIONS_DIR", "CHRONA_PROCESS_HELPER", "CHRONA_SDK"]) expect(env[name]).toBeUndefined();
});

test("packaged checker uses Web's actual contracts without changing the shipped SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-smoke-typecheck-")), repository = resolve(import.meta.dirname, "..");
  const resources = join(root, "resources"), sdk = join(resources, "module-sdk");
  try {
    for (const resource of buildArtifacts.resources.filter(resource => /^resources\/module-(sdk|typecheck)(\/|$)/.test(resource.to))) {
      const target = join(root, resource.to);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(repository, resource.from), target, { recursive: true });
    }
    await mkdir(join(resources, "external/web"), { recursive: true });
    await cp(join(repository, ".generated/applications/web/module.json"), join(resources, "external/web/module.json"));
    await cp(join(repository, ".generated/applications/notify"), join(resources, "external/notify"), { recursive: true });
    const original = await readFile(join(sdk, "calls.d.ts"), "utf8");
    await chmod(join(sdk, "calls.d.ts"), 0o444);
    await assertModuleTypecheck(resources);
    expect(await readFile(join(sdk, "calls.d.ts"), "utf8")).toBe(original);
    expect(await Bun.file(join(sdk, "calls.json")).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("release smoke approves only Web when configured active has no activated version", async () => {
  let approved = false;
  const requests: string[] = [];
  const server = Bun.serve({ port: 0, fetch: async request => {
    expect(request.headers.get("authorization")).toBe("Bearer smoke-key");
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (path === "/api/modules") return Response.json({ items: [{ id: "web-id", name: "web", status: "active", activeHash: approved ? "web-version" : null }] });
    if (path === "/api/approvals") return Response.json({ items: [
      { id: "qq-approval", moduleId: "qq-id", action: "activate_module" },
      { id: "web-removal", moduleId: "web-id", action: "delete_data" },
      { id: "web-approval", moduleId: "web-id", action: "activate_module" },
    ] });
    if (path === "/api/approvals/web-approval/resolve" && request.method === "POST") {
      expect(await request.json()).toEqual({ decision: "approve", scope: "once" });
      approved = true;
      return Response.json({ status: "approved" });
    }
    return new Response(null, { status: 404 });
  } });
  try {
    await approveSmokeWeb(`http://127.0.0.1:${server.port}`, "smoke-key");
    expect(approved).toBe(true);
    expect(requests.filter(request => request.startsWith("POST"))).toEqual(["POST /api/approvals/web-approval/resolve"]);
    expect(requests.at(-1)).toBe("GET /api/modules");
  } finally { server.stop(true); }
});

test("release smoke requires the external Pi application and its bundle without builtin resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-smoke-pi-"));
  const moduleDir = join(root, "external/pi");
  try {
    await mkdir(join(moduleDir, "vendor"), { recursive: true });
    await mkdir(join(root, "module-git"));
    await writeFile(join(moduleDir, "module.json"), JSON.stringify({ name: "pi" }));
    for (const file of ["package.json", "bun.lock", "runtime.js", "test.js"]) await writeFile(join(moduleDir, file), "fixture\n");
    await expect(assertPiReleaseResources(root)).rejects.toThrow("Pi module Git bundle missing");
    await writeFile(join(root, "module-git/pi.bundle"), "fixture bundle\n");
    await assertPiReleaseResources(root);
    expect(await Bun.file(join(root, "builtin/agent/module.json")).exists()).toBe(false);
    await writeFile(join(moduleDir, "module.json"), JSON.stringify({ name: "agent" }));
    await expect(assertPiReleaseResources(root)).rejects.toThrow("manifest mismatch");
    await writeFile(join(moduleDir, "module.json"), JSON.stringify({ name: "pi" }));
    await rm(join(moduleDir, "runtime.js"));
    await expect(assertPiReleaseResources(root)).rejects.toThrow("Pi external module resource missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});
