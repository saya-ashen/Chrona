import { join, resolve } from "node:path";
import { privateRoot } from "@chrona/workspaces";
import { processCapability } from "@chrona/process";
import { initializeConfig, loadConfig, localMapping, localPi, saveConfig, type DeviceConfig } from "./config";
import { RemoteDevice } from "./device";
import { MODEL_GATEWAY_GAP, kernelPiDriver } from "./driver";
import { DeviceDirectoryLock, Journal } from "./journal";
import { DeviceHTTP, DeviceHTTPError } from "./transport";
import { extractResources } from "./resources";
import { readPrivate } from "./private-files";
import { z } from "zod";

const help = `chrona-remote-device (Linux only)
  init --dir ABSOLUTE --server HTTPS_OR_LOOPBACK_ORIGIN --device-id ID
  pair --dir ABSOLUTE --code PAIRING_CODE
  pair --dir ABSOLUTE                         retry persisted pairing
  map --dir ABSOLUTE --file PRIVATE_JSON       trusted local target mapping
  pi --dir ABSOLUTE --file PRIVATE_JSON        {command:ABSOLUTE,expectedVersion:"1.5.0"}
  doctor --dir ABSOLUTE
  status --dir ABSOLUTE
  run --dir ABSOLUTE [--once]

init prints public pairing-create fields. No owner key is accepted or required.
Pi requires explicit local configuration and the trusted device/v1/model gateway.
map JSON: {workspaceRef,targetRef,targetRevision,projectRef,path,baseline:{kind,digest},workspaceModes}.
`;
function options(args: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!["--dir", "--server", "--device-id", "--code", "--file", "--once"].includes(key) || result[key] !== undefined) throw new Error("Invalid command options");
    if (key === "--once") result[key] = "true";
    else { const value = args[++i]; if (!value || value.startsWith("--")) throw new Error("Missing command option"); result[key] = value; }
  }
  return result;
}
async function pair(root: string, config: DeviceConfig, code?: string) {
  if (config.device) throw new Error("Device already paired; retained journals cannot silently rotate identity");
  if (config.pairing && code && code !== config.pairing.code) throw new Error("A different pairing intent is already retained");
  if (!config.pairing) {
    if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Pairing code is required");
    config.pairing = { code, requestId: crypto.randomUUID() };
    saveConfig(root, config); // Persist key, bearer and exact pairing retry before network I/O.
  }
  const receipt = await new DeviceHTTP(config.server, config.credential, null).pair(config.pairing.code, config.publicKey, config.pairing.requestId);
  if (receipt.device.deviceId !== config.deviceId || receipt.device.incarnation !== config.incarnation || receipt.device.keyId !== config.keyId) throw new Error("Pairing receipt identity mismatch");
  const journal = new Journal(root);
  try { journal.bind(receipt.device); } finally { journal.close(); }
  config.device = receipt.device; config.pairing = null; saveConfig(root, config);
  console.log(JSON.stringify({ state: receipt.state, device: receipt.device }));
}
export async function main(args = process.argv.slice(2)) {
  process.umask(0o077);
  const command = args[0];
  if (!command || command === "help" || command === "--help") { console.log(help); return; }
  if (process.platform !== "linux") throw new Error("Only local Linux is verified");
  const flags = options(args.slice(1)), root = flags["--dir"];
  if (!root || resolve(root) !== root) throw new Error("Absolute canonical --dir is required");
  if (command === "run") {
    const config = loadConfig(root), controller = new AbortController();
    const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const resources = extractResources(root), profileRoot = join(root, "profiles"); privateRoot(profileRoot);
    const driver = kernelPiDriver({ pi: config.pi, helperPath: resources.helperPath, chronaExtension: resources.paths["chrona-tools.ts"]!, profileRoot });
    const device = new RemoteDevice(root, config, new DeviceHTTP(config.server, config.credential, config.device, controller.signal), driver);
    try {
      do {
        try { await device.tick(); }
        catch (error) {
          if (controller.signal.aborted) break;
          console.error(error instanceof DeviceHTTPError ? error.message : "Device transport/state unavailable; evidence retained, running process state unchanged");
          if (flags["--once"]) throw error;
        }
        if (flags["--once"] || controller.signal.aborted) break;
        await new Promise<void>(done => { const timer = setTimeout(finish, 1000); function finish() { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); done(); } controller.signal.addEventListener("abort", finish, { once: true }); });
      } while (!controller.signal.aborted);
    } finally { await device.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    return;
  }
  const lock = new DeviceDirectoryLock(root);
  try {
    if (command === "init") {
      const config = initializeConfig(root, flags["--server"] ?? "", flags["--device-id"] ?? "");
      const journal = new Journal(root); journal.close();
      console.log(JSON.stringify({ deviceId: config.deviceId, incarnation: config.incarnation, keyId: config.keyId, publicKey: config.publicKey })); return;
    }
    const config = loadConfig(root);
    if (command === "pair") return await pair(root, config, flags["--code"]);
    if (command === "map") {
      const input = z.object({ workspaceRef: z.string().min(1), targetRef: z.string(), targetRevision: z.number().int().positive(), projectRef: z.string(), path: z.string(), baseline: z.object({ kind: z.enum(["commit", "snapshot"]), digest: z.string() }).strict(), workspaceModes: z.array(z.enum(["existing", "independent_worktree"])) }).strict().parse(JSON.parse(readPrivate(flags["--file"] ?? "")));
      const mapping = localMapping(input);
      config.mappings = [...config.mappings.filter(item => item.projectRef !== mapping.projectRef), mapping]; saveConfig(root, config);
      console.log(JSON.stringify({ mapped: true, mapping })); return;
    }
    if (command === "pi") {
      config.pi = localPi(JSON.parse(readPrivate(flags["--file"] ?? ""))); saveConfig(root, config);
      console.log(JSON.stringify({ configured: true, pi: config.pi })); return;
    }
    if (command === "doctor") {
      const resources = extractResources(root);
      console.log(JSON.stringify({ platform: resources.platform, native: processCapability({ helperPath: resources.helperPath }), resources: Object.keys(resources.paths), productionLaunch: config.pi ? { available: false, reason: "Pi configured; doctor does not certify the server device/v1/model route or kernel authority. Launch requires a reconciled immutable kernel offer." } : { available: false, reason: MODEL_GATEWAY_GAP } })); return;
    }
    if (command === "status") {
      const journal = new Journal(root);
      try { console.log(JSON.stringify({ paired: !!config.device, device: config.device, attempts: journal.attempts().map(item => ({ deliveryId: item.delivery.deliveryId, state: item.state, sourceWatermark: item.sourceWatermark })), pendingReports: journal.pending().length, modelGateway: config.pi ? "configured-unverified" : "unavailable" })); }
      finally { journal.close(); }
      return;
    }
    throw new Error("Unknown device command");
  } finally { lock.close(); }
}
if (import.meta.main) main().catch(error => { console.error(error instanceof DeviceHTTPError ? error.message : "Device command failed: invalid local configuration, unavailable resource, or protocol conflict. Private state is retained."); process.exitCode = 1; });
