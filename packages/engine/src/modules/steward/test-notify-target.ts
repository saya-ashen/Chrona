import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import notifyManifest from "./applications/notify/module.json";
import type { StewardPorts } from "./ports";
import { testModuleProcess } from "./module-test-process";

/** An ordinary approved target for routing tests; notification policy belongs to Notify's own tests. */
export async function installNotifyTarget(ports: StewardPorts, workspaceId: string, mockDelivery = false) {
  const hash = "test-notify-target";
  const manifest = moduleManifestSchema.parse({ name: "notify", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [notifyManifest.tools.find(tool => tool.name === "send")] });
  const module = await ports.db.module.create({ data: { workspaceId, name: "notify", status: "active", builtin: false, activeHash: hash } });
  await ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const codeDir = join(ports.dataDir, "platform/store", hash);
  await mkdir(codeDir, { recursive: true });
  await writeFile(join(codeDir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(codeDir, "index.ts"), `
import { on } from 'chrona';
on('tool', event => ({ result: { id: event.args.key, status: 'queued', duplicate: false } }));
`);
  await writeFile(join(codeDir, "test.ts"), "process.exit(0)");
  if (mockDelivery) {
    // Use a separate peer so background delivery cannot re-enter the caller's test handler.
    const peer = testModuleProcess(async event => {
      if (event.trigger.kind !== "tool") throw new Error("Expected notification tool event");
      return { result: { id: event.trigger.args.key, status: "queued", duplicate: false } };
    });
    const start = ports.sandbox!.startModule!;
    ports.sandbox!.startModule = input => input.codeDir === codeDir ? peer.startModule(input) : start(input);
  }
  return module;
}
