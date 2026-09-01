#!/usr/bin/env bun

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildTargets } from "../build/manifest";

if (process.platform !== "win32") {
  console.log("Windows private-storage smoke skipped outside Windows.");
  process.exit(0);
}

const ROOT = resolve(import.meta.dirname, "..");
const binary = resolve(ROOT, "dist/releases", buildTargets["windows-x64"].releaseName, buildTargets["windows-x64"].binaryName);
const root = mkdtempSync(join(tmpdir(), "chrona-windows-acl-"));
const data = join(root, "data");
const config = join(root, "config");
const appdata = join(root, "appdata");
const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
const port = server.port;
server.stop(true);
const env = { ...process.env, APPDATA: appdata, CHRONA_DATA_DIR: data, CHRONA_CONFIG_DIR: config, CHRONA_NO_OPEN: "1" };

try {
  mkdirSync(appdata, { recursive: true });
  const runtime = Bun.spawn([binary, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch { /* retry */ }
    await Bun.sleep(200);
  }
  if (Date.now() >= deadline) throw new Error("Windows packaged Chrona did not become healthy.");
  runtime.kill();
  await runtime.exited;
  const doctor = Bun.spawn([binary, "doctor"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const code = await doctor.exited;
  const output = `${await new Response(doctor.stdout).text()}\n${await new Response(doctor.stderr).text()}`;
  if (code !== 0 || output.includes("[error] dataDirectoryPermissions") || output.includes("[error] databasePermissions") || output.includes("[error] configDirectoryPermissions")) {
    throw new Error(`Windows ACL doctor smoke failed:\n${output}`);
  }
  console.log("✓ Windows private-storage ACL smoke passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
