// Host-executable contract tests. These test transport/parser behavior only;
// synthetic records cannot establish Windows native containment.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireDescendantStop, spawnSupervised } from "./index";
import { spawnWindowsGuardian } from "./windows-transport";

const posix = process.platform === "linux" || process.platform === "darwin";
let root: string, helper: string;
beforeAll(() => {
  if (!posix) return;
  root = mkdtempSync(join(tmpdir(), "chrona-protocol-"));
  helper = join(root, "fake-helper.mjs");
  writeFileSync(helper, `#!/usr/bin/env node
import { writeSync } from 'node:fs';
import { createConnection } from 'node:net';
import process from 'node:process';
const ready = JSON.stringify({event:'ready',version:1,pid:123,groupId:123})+'\\n';
const exit = JSON.stringify({event:'exit',code:0,signal:0,reason:'synthetic',groupStopped:true,descendantsStopped:true})+'\\n';
if (process.argv[2] === '--pipe') {
  const socket = createConnection(process.argv[3], () => {
    process.stdout.write('untrusted stdout\\n');
    socket.write(ready);
  });
  socket.on('data', data => { if (data.toString() === 'K') socket.end(exit); });
  socket.on('error', () => process.exit(125));
} else {
  const mode = process.argv[2];
  const frames = { missing: ready, malformed: ready+'no json\\n', duplicate: ready+exit+exit,
    truncated: ready+exit.slice(0,-1), premature: exit, overflow: ready+'x'.repeat(5000),
    false: ready+exit.replace('"descendantsStopped":true','"descendantsStopped":false') };
  writeSync(4, frames[mode]);
}
`);
  chmodSync(helper, 0o700);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(!posix)("host protocol contracts, not native Windows evidence", () => {
  test("private duplex transport preserves status after control end; stdout is separate", async () => {
    const transport = spawnWindowsGuardian(helper, "cancel", [], {}, join(root, "control.sock"));
    let status = "", output = "", cancelled = false;
    transport.status.setEncoding("utf8");
    transport.status.on("data", chunk => {
      status += chunk;
      if (!cancelled && status.includes('"event":"ready"')) { cancelled = true; transport.control.end("K"); }
    });
    transport.child.stdin.end(); transport.child.stderr.resume();
    transport.child.stdout.on("data", chunk => { output += chunk; });
    try {
      const code = await new Promise(resolve => transport.child.once("close", resolve));
      await transport.statusFinished;
      expect(code).toBe(0);
      expect(status.trim().split("\n").map(line => JSON.parse(line).event)).toEqual(["ready", "exit"]);
      expect(status).not.toContain("untrusted stdout");
      expect(output).toBe("untrusted stdout\n");
    } finally { transport.dispose(); transport.child.kill("SIGKILL"); }
  });
  test("failed helper spawn closes the private server/status channel", async () => {
    const transport = spawnWindowsGuardian(join(root, "missing"), "command", [], {}, join(root, "missing.sock"));
    const error = await new Promise<Error>(resolve => transport.child.once("error", resolve));
    await transport.statusFinished;
    expect(error.message).toContain("ENOENT");
    transport.dispose();
  });
  for (const mode of ["missing", "malformed", "duplicate", "truncated", "premature", "overflow", "false"]) {
    test(`${mode} cleanup evidence cannot release descendant capacity`, async () => {
      const task = spawnSupervised(mode, [], { helperPath: helper });
      task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
      const exit = await task.exited;
      expect(exit.stop.treeClean).toBe(false);
      expect(() => requireDescendantStop(exit)).toThrow("stop unknown");
    });
  }
});
