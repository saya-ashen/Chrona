import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { THINKING_LEVELS, modelTier, type HardLimits, camelArguments } from "@chrona/contracts/steward";

export const modelPolicySchema = z.object({
  tiers: z.record(modelTier, z.object({ model: z.string().trim().min(1).max(500), thinking: z.enum(THINKING_LEVELS).optional() }).strict()),
  preferredTimeoutMs: z.number().int().min(1).max(600_000),
}).strict();
export const SETTINGS_TIERS = ["fast", "balanced", "deep"] as const;
const formTier = z.object({ model: z.string().trim().max(500), thinking: z.enum(["", ...THINKING_LEVELS]) }).strict();
export const policyFormSchema = z.object({
  tiers: z.object({ fast: formTier, balanced: formTier, deep: formTier }).strict(),
  preferredTimeoutMs: z.string().trim().regex(/^\d+$/),
}).strict();
export const configureInput = z.object({ config: modelPolicySchema.optional(), clear: z.boolean().optional(), form: policyFormSchema.optional(), view: z.boolean().optional() }).strict()
  .refine(value => [value.config !== undefined, value.clear === true, value.form !== undefined].filter(Boolean).length <= 1, "Choose config, form or clear");
export const configureOutput = z.object({ config: modelPolicySchema.nullable(), ready: z.boolean(), form: policyFormSchema.optional() }).strict();
function policyForm(config: z.infer<typeof modelPolicySchema> | null): z.infer<typeof policyFormSchema> {
  return {
    tiers: Object.fromEntries(SETTINGS_TIERS.map(tier => [tier, { model: config?.tiers[tier]?.model ?? "", thinking: config?.tiers[tier]?.thinking ?? "" }])) as z.infer<typeof policyFormSchema>["tiers"],
    preferredTimeoutMs: String(config?.preferredTimeoutMs ?? 60_000),
  };
}
type Policy = z.infer<typeof modelPolicySchema>;
/** Agent owns model selection. Only the routed kernel callback can authorize owner configuration. */
export function createModelPolicy(data: string, authorize: (callId: string) => Promise<unknown>, backendReady: () => Promise<boolean>) {
  const path = join(data, "model-policy.json");
  let writes = Promise.resolve();
  async function read(): Promise<Policy | null> {
    await writes;
    try { return modelPolicySchema.nullable().parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async function ready() { const config = await read(); return !!config && Object.keys(config.tiers).length > 0 && await backendReady(); }
  async function configure(raw: unknown, callId: string) {
    const normalized = camelArguments(raw) as Record<string, unknown>;
    const originalConfig = (raw as { config?: { tiers?: unknown } } | null)?.config;
    if (originalConfig?.tiers && normalized.config) (normalized.config as Record<string, unknown>).tiers = originalConfig.tiers;
    const args = configureInput.parse(normalized);
    z.object({ authorized: z.literal(true) }).parse(await authorize(callId));
    if (args.config !== undefined || args.clear || args.form) {
      const write = writes.then(async () => {
        let config = args.clear ? null : args.config!;
        if (args.form) {
          // Read inside the serialized write so a form never discards existing custom tiers.
          let current: Policy | null = null;
          try { current = modelPolicySchema.nullable().parse(JSON.parse(await readFile(path, "utf8"))); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const tiers = { ...current?.tiers };
          for (const tier of SETTINGS_TIERS) {
            const target = args.form.tiers[tier];
            if (target.model) tiers[tier] = { model: target.model, ...(target.thinking ? { thinking: target.thinking } : {}) };
            else delete tiers[tier];
          }
          config = modelPolicySchema.parse({ tiers, preferredTimeoutMs: Number(args.form.preferredTimeoutMs) });
        }
        await mkdir(data, { recursive: true, mode: 0o700 });
        const temporary = path + "." + randomUUID() + ".pending";
        await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
        await rename(temporary, path);
      });
      writes = write.catch(() => {});
      await write;
    }
    const config = await read();
    return { config, ready: await ready(), ...(args.view || args.form ? { form: policyForm(config) } : {}) };
  }
  async function select(declaredTier: string, hardLimits: HardLimits, maxOutputTokens: number) {
    const config = await read(), target = config?.tiers[declaredTier];
    if (!target || !await backendReady()) throw new Error("unconfigured: Agent completion tier unavailable");
    return { ...target, maxOutputTokens: Math.min(maxOutputTokens, hardLimits.maxOutputTokens), timeoutMs: Math.min(config!.preferredTimeoutMs, hardLimits.eventTimeoutMs) };
  }
  return { configure, ready, select };
}
export type ModelPolicy = ReturnType<typeof createModelPolicy>;
