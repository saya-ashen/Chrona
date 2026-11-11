import { CallError } from "./module-call-error";

/** Temporary runtime and release admission policy. Source and Git provenance remain retained for review. */
export const PAUSED_MODULE_NAMES = ["remind"] as const;
const paused: ReadonlySet<string> = new Set(PAUSED_MODULE_NAMES);

export function isModulePaused(name: string): boolean { return paused.has(name); }

export class ModuleUnavailableError extends CallError {
  override readonly reason = "module_paused";
  constructor(name: string) {
    super("unavailable", `Module ${name} is unavailable: paused pending the owner's boundary decision; source is retained`);
    this.name = "ModuleUnavailableError";
  }
}
export function assertModuleAvailable(name: string): void {
  if (isModulePaused(name)) throw new ModuleUnavailableError(name);
}
