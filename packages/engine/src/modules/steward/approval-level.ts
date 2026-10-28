import type { Prisma } from "@chrona/db";
import { APPROVAL_LEVELS, approvalBriefSchema, isEntryModule, listenPaths, moduleManifestSchema } from "@chrona/contracts/steward";
import type { z } from "zod";
import { join } from "node:path";
import { dataEmpty } from "./module-data";

/**
 * v2-17: an approval's risk level, from facts the kernel can check (manifests, data schema, sandbox, action) and never
 * from text a module or model wrote. green: nothing new and undoable; yellow: something new but undoable; red: money,
 * data loss, outside effects, credentials that can leave, acting as the user, or code that runs unisolated.
 */
export type Level = (typeof APPROVAL_LEVELS)[number];
export type Brief = z.infer<typeof approvalBriefSchema>;
type Db = Prisma.TransactionClient;
type Manifest = ReturnType<typeof moduleManifestSchema.parse>;
export const higher = (a: Level, b: Level): Level => APPROVAL_LEVELS.indexOf(a) >= APPROVAL_LEVELS.indexOf(b) ? a : b;

export const RED_ACTIONS = new Set(["send_external_message", "delete_data", "purchase", "share_third_party", "change_credentials", "change_policy", "access_host_path"]);
const EFFECTS: Record<string, string> = { network: "联网", model: "调用模型", notify_user: "给你发通知", wake_provider: "唤醒 Chrona 处理" };

/** What `next` can do that `previous` (the active version, if any) cannot. */
export function addedCapabilities(previous: Manifest | null, next: Manifest) {
  const had = <T>(list: (manifest: Manifest) => T[], value: T) => !!previous && list(previous).includes(value);
  return [
    ...next.effects.filter(effect => !had(m => m.effects, effect)).map(effect => EFFECTS[effect] ?? effect),
    ...next.uses.filter(target => !had(m => m.uses, target)).map(target => target === "*" ? "调用你能用的所有工具" : `调用 ${target}`),
    ...next.secrets.filter(name => !had(m => m.secrets, name)).map(name => `读取凭据 ${name}`),
    ...next.packages.filter(name => !had(m => m.packages, name)).map(name => `系统程序 ${name}`),
    ...(next.limits && next.limits.virtualMemoryMb > (previous?.limits?.virtualMemoryMb ?? 1024) ? [`内存地址空间上限 ${next.limits.virtualMemoryMb} MB`] : []),
    ...listenPaths(next).filter(path => !previous || !listenPaths(previous).includes(path)).map(path => `网页入口 ${path}`),
    ...next.tools.filter(tool => tool.visibility.includes("modules") && !previous?.tools.find(old => old.name === tool.name)?.visibility.includes("modules")).map(tool => `供其他模块调用 ${tool.name}`),
  ];
}

/** One module version being activated (or a data restore). */
async function manifestOf(tx: Db, moduleId: string, hash: string | null) {
  if (!hash) return null;
  return moduleManifestSchema.safeParse((await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } }))?.manifest).data ?? null;
}
/** A schema change migrates only data that exists; without a data directory to look at, assume there is some. */
async function migratesData(dataDir: string | undefined, module: { id: string; dataSchema: number | null }, manifest: Manifest) {
  if (manifest.data.schema === module.dataSchema) return false;
  return !dataDir || !await dataEmpty(join(dataDir, "platform", "data", module.id));
}
/**
 * Code that runs unisolated, moves data, newly acts as the user (a new entry module, or one gaining capabilities), or newly
 * holds a credential it can send out. An entry module's update that adds nothing is yellow: always asked, never automatic.
 */
const canLeak = (manifest: Manifest) => manifest.secrets.length > 0 && manifest.effects.includes("network");
const newlyLeaks = (previous: Manifest | null, next: Manifest) =>
  canLeak(next) && !(previous?.effects.includes("network") && next.secrets.every(name => previous.secrets.includes(name)));
const isRed = (isolated: boolean, previous: Manifest | null, manifest: Manifest, added: string[], movesData: boolean) =>
  !isolated || movesData || newlyLeaks(previous, manifest) || (isEntryModule(manifest) && (!previous || !isEntryModule(previous) || added.length > 0));
const levelOf = (isolated: boolean, previous: Manifest | null, manifest: Manifest, added: string[], movesData: boolean): Level =>
  isRed(isolated, previous, manifest, added, movesData) ? "red" : added.length || !previous || isEntryModule(manifest) ? "yellow" : "green";
async function assessVersion(tx: Db, { isolated, dataDir }: Facts, target: { moduleId: string; hash: string; restore?: unknown }) {
  const module = await tx.module.findUnique({ where: { id: target.moduleId } });
  const manifest = module ? await manifestOf(tx, module.id, target.hash) : null;
  if (!module || !manifest) return { name: module?.name ?? "?", fresh: false, level: "red" as Level, added: [], reversible: false };
  const active = await manifestOf(tx, module.id, module.activeHash), restore = !!target.restore;
  const added = addedCapabilities(active, manifest), migrates = !!active && await migratesData(dataDir, module, manifest);
  const level = levelOf(isolated, active, manifest, added, restore || migrates);
  return { name: isEntryModule(manifest) ? `${module.name}（入口模块）` : module.name, fresh: !active, level, added, reversible: !restore && !migrates };
}
function activationTargets(payload: unknown): { moduleId: string; hash: string; restore?: unknown }[] {
  const value = payload as { kind?: string; moduleId?: string; hash?: string; restore?: unknown; versions?: { moduleId: string; hash: string }[] } | null;
  if (value?.kind === "activate_modules") return value.versions ?? [];
  return value?.moduleId && value.hash ? [{ moduleId: value.moduleId, hash: value.hash, ...(value.restore ? { restore: value.restore } : {}) }] : [];
}

/** What the kernel knows about where modules run: isolated by the sandbox, and where their data lives. */
export type Facts = { isolated: boolean; dataDir?: string };
export async function assessApproval(tx: Db, facts: Facts, input: { action: string; title: string; payload: unknown; level?: Level }): Promise<{ level: Level; brief: Brief }> {
  const base = { reviewed: null, reason: null };
  if (input.action === "activate_module") {
    const versions = await Promise.all(activationTargets(input.payload).map(target => assessVersion(tx, facts, target)));
    const level = versions.reduce<Level>((most, version) => higher(most, version.level), versions.length ? "green" : "red");
    const added = versions.flatMap(version => versions.length > 1 ? version.added.map(item => `${version.name}：${item}`) : version.added);
    const names = versions.map(version => version.name).join("、");
    const restore = activationTargets(input.payload).some(target => target.restore);
    const verb = versions.every(version => version.fresh) ? "启用新应用" : versions.length > 1 ? "一起启用" : "更新";
    const headline = restore ? `回滚 ${names} 并恢复旧数据，此后写入的数据会丢失` : `${verb} ${names}${verb !== "更新" ? "" : added.length ? "，能力有增加" : "，能力不变"}`;
    return { level: higher(level, input.level ?? "green"), brief: { ...base, headline: headline.slice(0, 300), added: added.slice(0, 20), reversible: versions.every(version => version.reversible) } };
  }
  const level = higher(RED_ACTIONS.has(input.action) ? "red" : "yellow", input.level ?? "green");
  return { level, brief: { ...base, headline: input.title.slice(0, 300), added: [], reversible: input.action === "delete_data" ? false : null } };
}

/** v2-17 §3: not yet reviewed and still fresh: the chat notice waits for the review (a stale one is announced anyway). */
export function awaitingReview(row: { brief: unknown; createdAt: Date }, now: Date) {
  const brief = approvalBriefSchema.safeParse(row.brief).data;
  return !!brief && brief.reviewed === null && now.getTime() - row.createdAt.getTime() < 10 * 60_000;
}
