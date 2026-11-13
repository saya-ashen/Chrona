import { z } from "zod";
import { MindStore, digest } from "./store";
import { MindService } from "./service";

import { sourceInput } from "./schema";

type Target = string | { moduleId: string; tool: string };
type Call = (target: Target, args: Record<string, unknown>, options?: { expectedTarget: { moduleId: string }; timeoutMs: number }) => Promise<unknown>;
const reference = z.object({ source: z.object({ kind: z.literal("module"), hash: z.string() }), sideEffects: z.array(z.string()).length(0) });
/** A concrete read adapter: only Files' bounded read contract, never arbitrary tools or URLs. */
export class MindSources {
  private pending: Promise<void> | null = null;
  constructor(private store: MindStore, private service: MindService, private filesId: () => string | undefined, private call: Call) {}
  async configure(raw: unknown) {
    const args = sourceInput.parse(raw);
    if (args.paths !== undefined) {
      const paths = z.array(z.string().min(1).max(128)).max(4).parse(args.paths.split("\n").map(path => path.trim()).filter(Boolean));
      if (new Set(paths).size !== paths.length) throw new Error("Duplicate source path");
      const moduleId = this.filesId();
      if (paths.length && !moduleId) throw new Error("Files application unavailable");
      if (paths.length) reference.parse(await this.call("modules.describe", { target: { moduleId: moduleId!, tool: "read" } }));
      await this.store.update(state => { state.sources = paths.map(path => state.sources?.find(row => row.path === path && row.moduleId === moduleId) ?? { path, moduleId: moduleId!, version: null, error: null }); });
    }
    const sources = (await this.store.read()).sources ?? [];
    return { sources, paths: sources.map(row => row.path).join("\n"), errors: sources.filter(row => row.error).map(row => `${row.path}: ${row.error}`).join("\n") };
  }
  async poll(now: string) {
    if (this.pending) return this.pending;
    this.pending = this.read(now).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async read(now: string) {
    const state = await this.store.read();
    if (!state.settings.enabled) return;
    for (const bound of state.sources ?? []) {
      try {
        if (this.filesId() !== bound.moduleId) throw new Error("Files identity changed; configure sources again");
        const target = { moduleId: bound.moduleId, tool: "read" };
        reference.parse(await this.call("modules.describe", { target }));
        const file = z.object({ content: z.string().max(2000), truncated: z.literal(false), size: z.number().int().nonnegative().max(8000), mime: z.string() }).strict().parse(await this.call(target, { path: bound.path }, { expectedTarget: { moduleId: bound.moduleId }, timeoutMs: 10_000 }));
        const version = digest(file.content);
        // Recheck owner configuration after asynchronous reads, before accepting evidence.
        await this.store.update(current => {
          const entry = current.sources?.find(row => row.path === bound.path && row.moduleId === bound.moduleId);
          if (!current.settings.enabled || !entry) return;
          if (entry.version !== version) {
            this.service.observeFile(current, { moduleId: bound.moduleId, path: bound.path, version, text: file.content }, now);
            entry.version = version;
          }
          entry.error = null;
        });
      } catch {
        await this.store.update(current => { const entry = current.sources?.find(row => row.path === bound.path && row.moduleId === bound.moduleId); if (entry) entry.error = "来源读取失败或合同已改变；请核对文件与来源设置。旧内容未当作新证据。"; });
      }
    }
  }
}
