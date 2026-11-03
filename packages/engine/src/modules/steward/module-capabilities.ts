import { listenPaths, moduleManifestSchema, secretNames } from "@chrona/contracts/steward";

type Manifest = ReturnType<typeof moduleManifestSchema.parse>;
const EFFECTS: Record<string, string> = { network: "联网", model: "调用模型", notify_user: "给你发通知", wake_provider: "唤醒 Chrona 处理" };

/** What `next` can do that `previous` (the active version, if any) cannot; for the app overview. */
export function addedCapabilities(previous: Manifest | null, next: Manifest) {
  const had = <T>(list: (manifest: Manifest) => T[], value: T) => !!previous && list(previous).includes(value);
  return [
    ...next.effects.filter(effect => !had(m => m.effects, effect)).map(effect => EFFECTS[effect] ?? effect),
    ...next.uses.filter(target => !had(m => m.uses, target)).map(target => target === "*" ? "调用你能用的所有工具" : `调用 ${target}`),
    ...secretNames(next).filter(name => !had(secretNames, name)).map(name => `读取凭据 ${name}`),
    ...next.packages.filter(name => !had(m => m.packages, name)).map(name => `系统程序 ${name}`),
    ...(next.limits && next.limits.virtualMemoryMb > (previous?.limits?.virtualMemoryMb ?? 1024) ? [`内存地址空间上限 ${next.limits.virtualMemoryMb} MB`] : []),
    ...listenPaths(next).filter(path => !previous || !listenPaths(previous).includes(path)).map(path => `网页入口 ${path}`),
    ...next.tools.filter(tool => tool.visibility.includes("modules") && !previous?.tools.find(old => old.name === tool.name)?.visibility.includes("modules")).map(tool => `供其他模块调用 ${tool.name}`),
  ];
}
