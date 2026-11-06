import type { ModuleInstallRequest, ModuleInstallResult } from "@chrona/contracts/steward";

/** The selected release identity checked again before submission; no host path authority is granted here. */
export type ExternalModuleInstaller = (input: {
  workspaceId: string;
  request: ModuleInstallRequest;
  release: { name: string; origin: "builtin" | "external"; codeDir: string; hash: string };
}) => Promise<ModuleInstallResult>;
