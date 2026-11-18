import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { diagnosticText } from "./module-diagnostics";
import type { DeliveryOptions, DeliveryStage, Reply } from "./module-supervisor-state";

export class ModuleActivationAnnouncements {
  constructor(private readonly ports: StewardPorts,
    private readonly deliver: (moduleId: string, hash: string, event: ModuleEvent, options: DeliveryOptions) => Promise<Reply>,
    private readonly isStopped: () => boolean) {}
  /**
   * `activated` reaches each module declaring it once per active version and again when a module it `uses` changes version
   * (module-dependency-direction §4), so a sleeping application can refresh its dependency registration. Recorded in platform/activated.json;
   * Successful delivery and unconfirmed dispatch remain distinct across restarts.
   */
  private announced?: Record<string, string | { signature: string; activationId: string; status: "unconfirmed" }>;
  private announcing = false;
  private readonly manifests = new Map<string, ModuleManifest | null>();
  private async saveAnnouncements(file: string) {
    await mkdir(join(this.ports.dataDir, "platform"), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(this.announced));
    await rename(`${file}.tmp`, file);
  }
  private async announceModule(file: string,
    module: { id: string; name: string; activeHash: string | null; activationId: string }, hashes: Map<string, string | null>) {
    const hash = module.activeHash!, manifest = await this.manifestOf(module.id, hash);
    if (!manifest?.activated || this.isStopped()) return;
    const uses = [...new Set(manifest.uses.filter(target => target !== "*").map(target => target.split(".")[0]!))]
      .filter(name => name !== module.name && hashes.has(name)).sort();
    const signature = [hash, ...uses.map(name => `${name}@${hashes.get(name)}`)].join(" ");
    const previous = this.announced![module.id];
    if (previous === signature) return;
    if (typeof previous === "object" && previous.activationId === module.activationId) return;
    const delivered = await this.deliverActivation(module.id, hash, async () => {
      const current = await this.ports.db.module.findUniqueOrThrow({ where: { id: module.id }, select: { activationId: true } });
      if (current.activationId !== module.activationId) throw new Error("Module activation changed before announcement dispatch");
      this.announced![module.id] = { signature, activationId: module.activationId, status: "unconfirmed" };
      await this.saveAnnouncements(file);
    });
    if (delivered === true) this.announced![module.id] = signature;
    else if (delivered === false) delete this.announced![module.id];
    await this.saveAnnouncements(file);
  }
  async announce(modules: { id: string; name: string; activeHash: string | null; activationId: string }[]) {
    if (this.announcing || this.isStopped()) return;
    this.announcing = true;
    const file = join(this.ports.dataDir, "platform", "activated.json");
    try {
      if (!this.announced) {
        try { this.announced = JSON.parse(await readFile(file, "utf8")); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          this.announced = {};
        }
      }
      const hashes = new Map(modules.map(module => [module.name, module.activeHash]));
      for (const module of modules) {

        await this.announceModule(file, module, hashes);
      }
    } finally { this.announcing = false; }
  }
  private async deliverActivation(moduleId: string, hash: string, beforeDelivery: () => Promise<void>) {
    const now = this.ports.now().toISOString();
    try { await this.deliver(moduleId, hash, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} }, { beforeDelivery }); }
    catch (error) {
      const stage = (error as { stage?: DeliveryStage }).stage;
      console.error(JSON.stringify({ component: "module-supervisor", event: "activation.failed", moduleId, hash,
        delivery: stage ?? "unconfirmed", error: diagnosticText(String(error), 1000) }));
      return stage === "unavailable" ? false : null;
    }
    return true;
  }
  private async manifestOf(moduleId: string, hash: string) {
    if (!this.manifests.has(hash)) this.manifests.set(hash, moduleManifestSchema.safeParse((await this.ports.db.moduleVersion.findUnique({
      where: { moduleId_hash: { moduleId, hash } } }))?.manifest).data ?? null);
    return this.manifests.get(hash);
  }
}
