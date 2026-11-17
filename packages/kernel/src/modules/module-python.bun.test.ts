import { afterEach, expect, test } from "bun:test";
import "./module-effects";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import runtimeTable from "../../../host/src/runtimes.json";
import { createApprovals } from "../approvals";
import { createModules } from "./modules";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "../ports";
import { testDb } from "../__testing__/test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const pythonRuntime = runtimeTable.runtimes.find(runtime => runtime.extensions.includes(".py"))!;
const pythonPrograms = process.platform === "win32" ? pythonRuntime.programs.win32 ?? pythonRuntime.programs.default : pythonRuntime.programs.default;
const hasPython = pythonPrograms.some(program => Bun.which(program) !== null);
const intent = { changes: ["Install a Python greeting tool"], preserves: ["Keep module data private"] };
const manifest = {
  name: "python-acceptance", entry: "main.py", keepAlive: true, activated: true,
  tools: [{ name: "greet", description: "Return a local Python greeting", visibility: ["owner"],
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    output: { type: "object", properties: { message: { type: "string" }, calls: { type: "integer" }, pid: { type: "integer" } }, required: ["message", "calls", "pid"], additionalProperties: false } }],
  effects: [], tests: ["test.py"], params: { prefix: { type: "string", value: "Hello " } },
  // A declaration alone exercises explicit approval; the fixture never reads a credential.
  secrets: ["python_fixture_key"],
};

// Local Python acceptance of the S4 authenticated TCP NDJSON protocol.
// No third-party Python SDK, package download, model, or external connection is involved.
const mainSource = `import json
import os
from pathlib import Path
import socket
from urllib.parse import urlparse


def greeting(event, calls):
    return {"message": event["params"]["prefix"] + event["trigger"]["args"]["name"],
            "calls": calls, "pid": os.getpid()}


def main():
    calls = 0
    endpoint = urlparse(os.environ["CHRONA_IPC_ENDPOINT"])
    assert endpoint.scheme == "tcp" and endpoint.hostname == "127.0.0.1"
    with socket.create_connection((endpoint.hostname, endpoint.port), timeout=5) as connection:
        connection.sendall((json.dumps({"type": "auth", "version": 1, "token": os.environ["CHRONA_IPC_TOKEN"]}) + "\\n").encode("utf-8"))
        with connection.makefile("r", encoding="utf-8") as messages:
            assert json.loads(messages.readline()) == {"type": "ready", "version": 1}
            connection.settimeout(None)
            for line in messages:
                message = json.loads(line)
                reply = {"id": message["id"], "result": {}}
                if not message.get("ping"):
                    event = message["event"]
                    trigger = event["trigger"]
                    if trigger["kind"] == "activated":
                        marker = {"pid": os.getpid(), "codeDir": str(Path.cwd()),
                                  "moduleDir": os.environ["CHRONA_MODULE"], "dataDir": os.environ["CHRONA_DATA"]}
                        Path(os.environ["CHRONA_DATA"], "activated.json").write_text(json.dumps(marker), encoding="utf-8")
                    elif trigger["kind"] == "tool" and trigger["id"] == "greet":
                        calls += 1
                        reply["result"] = {"result": greeting(event, calls)}
                    else:
                        raise ValueError("Unexpected event")
                connection.sendall((json.dumps(reply, ensure_ascii=False) + "\\n").encode("utf-8"))


if __name__ == "__main__":
    main()
`;
const testSource = `import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from main import greeting

request = json.load(sys.stdin)
assert request["now"]
assert request["params"] == {"prefix": "Hello "}
assert Path.cwd() == Path(os.environ["CHRONA_MODULE"])
assert Path(os.environ["CHRONA_DATA"]).is_dir()
event = {"params": request["params"], "trigger": {"args": {"name": "Python"}}}
assert greeting(event, 1) == {"message": "Hello Python", "calls": 1, "pid": os.getpid()}
print("python author tests passed")
`;

async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await realpath(await mkdtemp(join(tmpdir(), "chrona-python-")));
  const runtime = createScriptSandbox({ executionMode: "trusted-local", dataDir });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(),
    moduleRuntimes: runtimeTable, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  const supervisor = moduleSupervisor(ports);
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "python-acceptance" } });
  const modules = createModules(ports, workspace.id);
  const approvals = createApprovals({ db, workspaceId: workspace.id, now: ports.now }, action => modules.onApproved(action), ports);
  const root = join(dataDir, "source"), dir = join(root, manifest.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "main.py"), mainSource);
  await writeFile(join(dir, "test.py"), testSource);
  const propose = () => modules.propose({ root, dir: manifest.name, intent }, "user");
  return { db, dataDir, dir, workspace, modules, approvals, propose };
}

test.skipIf(!hasPython)("S1 installs, approves and starts a real Python module, then routes owner tool calls", async () => {
  const f = await fixture(), proposal = await f.propose();
  expect(proposal.status).toBe("building");
  expect(typeof proposal.moduleId).toBe("string");
  const moduleId = proposal.moduleId!, hash = proposal.hash;
  const version = () => f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId, hash } } });
  await f.modules.buildPending();
  expect(await version()).toMatchObject({ status: "pending_review", report: {
    tests: [{ exitCode: 0, stdout: "python author tests passed\n", stderr: "" }],
  } });
  const installed = join(f.dataDir, "platform", "store", hash);
  expect(await readFile(join(installed, "main.py"), "utf8")).toBe(mainSource);
  expect(await readFile(join(installed, "test.py"), "utf8")).toBe(testSource);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: moduleId } })).toMatchObject({ activeHash: null });
  await expect(f.modules.callTool("m_python_acceptance_greet", { name: "before approval" })).rejects.toMatchObject({ code: "not_found" });
  const approval = await f.db.approval.findFirstOrThrow({ where: { workspaceId: f.workspace.id, moduleId, action: "activate_module", status: "open" } });
  expect(approval.payload).toMatchObject({ moduleId, hash });

  // Execution must use the installed snapshot, even after the submitted working copy disappears.
  await rm(f.dir, { recursive: true });
  await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" }, "cli");
  expect(await version()).toMatchObject({ status: "approved" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: moduleId } })).toMatchObject({ activeHash: hash, status: "active" });
  const data = join(f.dataDir, "platform", "data", moduleId), markerPath = join(data, "activated.json");
  for (let attempt = 0; attempt < 300 && !await Bun.file(markerPath).exists(); attempt++) await Bun.sleep(10);
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  expect(typeof marker.pid).toBe("number");
  expect(marker).toMatchObject({ codeDir: installed, moduleDir: installed, dataDir: data });
  expect((await f.modules.tools()).tools.map(tool => tool.name)).toContain("m_python_acceptance_greet");
  expect(await f.modules.callTool("m_python_acceptance_greet", { name: "世界" })).toEqual({ result: { message: "Hello 世界", calls: 1, pid: marker.pid } });
  expect(await f.modules.callTool("m_python_acceptance_greet", { name: "Python" })).toEqual({ result: { message: "Hello Python", calls: 2, pid: marker.pid } });
  expect(await f.db.moduleInvocation.count({ where: { workspaceId: f.workspace.id, target: manifest.name, tool: "greet", status: "succeeded" } })).toBe(2);
}, 20_000);

test("S1 rejects a Python proposal carrying the removed memory limits field", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ ...manifest, limits: { virtualMemoryMb: 256 } }));
  const proposal = await f.propose();
  expect(proposal).toMatchObject({ status: "rejected", moduleId: null });
  expect(proposal.report.errors?.join("\n")).toContain("limits");
  expect(await f.db.module.count({ where: { workspaceId: f.workspace.id } })).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
});
