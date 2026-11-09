import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSupervised, requireDescendantStop } from "@chrona/process";
import { elfInterpreter } from "./linux-artifact";

// Run AFTER build. Only the copied command is given an empty PATH and an unrelated
// cwd: it cannot find Bun, the source tree, node_modules, Pi extensions or a compiler.
const artifact = resolve(import.meta.dir, "../dist/chrona-remote-device");
const scratch = mkdtempSync(join(tmpdir(), "chrona-device-standalone-"));
// NixOS provides the standard loader via nix-ld. Supply only its public host
// loader location, never credentials or source/resource overrides.
const hostLoader = elfInterpreter(readFileSync(process.execPath));
const env = { PATH: "", LANG: "C.UTF-8", ...(hostLoader.startsWith("/nix/store/") ? { NIX_LD: hostLoader, NIX_LD_LIBRARY_PATH: dirname(hostLoader) } : {}) };
try {
  const binary = join(scratch, "device"), root = join(scratch, "private");
  copyFileSync(artifact, binary); chmodSync(binary, 0o755);
  function cli(...args: string[]) {
    const result = spawnSync(binary, args, { cwd: scratch, env, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  assert.match(cli("--help"), /Linux only/);
  const publicFields = JSON.parse(cli("init", "--dir", root, "--server", "http://127.0.0.1:9", "--device-id", "standalone-smoke"));
  assert.equal(publicFields.credential, undefined); assert.equal(publicFields.privateKey, undefined);
  const doctor = JSON.parse(cli("doctor", "--dir", root));
  assert.equal(doctor.native.available, true); assert.equal(doctor.native.scope, "descendants");
  assert.equal(doctor.productionLaunch.available, false); assert.match(doctor.productionLaunch.reason, /execution.model/);
  assert.deepEqual(doctor.resources.sort(), ["browser-tools.ts", "chrona-process-guardian", "chrona-tools.ts"]);
  assert.equal(JSON.parse(cli("status", "--dir", root)).pendingReports, 0);
  for (const name of ["config.json", "journal.sqlite", "directory-lock.sqlite"]) assert.equal(statSync(join(root, name)).mode & 0o777, 0o600);
  const resourceDirectory = join(root, "resources"), names = readdirSync(resourceDirectory);
  const helper = join(resourceDirectory, names.find(name => name.endsWith("-chrona-process-guardian"))!);
  assert.equal(statSync(helper).mode & 0o777, 0o700);
  const portableLoader = process.arch === "x64" ? "/lib64/ld-linux-x86-64.so.2" : "/lib/ld-linux-aarch64.so.1";
  assert.equal(elfInterpreter(readFileSync(binary)), portableLoader);
  assert.equal(elfInterpreter(readFileSync(helper)), portableLoader);
  // The actual helper extracted by the copied command also runs and proves stop.
  const supervised = spawnSupervised("/bin/sh", ["-c", "printf standalone-native"], { helperPath: helper, cwd: scratch, env, timeoutMs: 5000 });
  let text = ""; supervised.process.stdout.on("data", chunk => { text += String(chunk); }); supervised.process.stderr.resume();
  const exit = requireDescendantStop(await supervised.exited); assert.equal(exit.code, 0); assert.equal(text, "standalone-native");
  writeFileSync(helper, "changed", { mode: 0o700 });
  const changed = spawnSync(binary, ["doctor", "--dir", root], { cwd: scratch, env, encoding: "utf8", timeout: 10000 });
  assert.equal(changed.status, 1); assert.doesNotMatch(changed.stderr, /PRIVATE KEY|credential/);
  console.log("Copied standalone command: private init/status, embedded resources, native descendant stop, tamper rejection; empty PATH; no network.");
} finally { rmSync(scratch, { recursive: true, force: true }); }
