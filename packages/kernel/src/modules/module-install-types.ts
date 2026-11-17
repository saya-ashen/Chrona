import { z } from "zod";
import type { ModuleInstallRequest, ModuleInstallResult } from "@chrona/contracts/steward";

export const exactReleaseBaselineSchema = z.object({ activeHash: z.string(), versionId: z.string(), activationId: z.string().nullable() }).strict();
export type ExactReleaseBaseline = z.infer<typeof exactReleaseBaselineSchema>;

export type InstallationRequest = Omit<ModuleInstallRequest, "mode"> & { mode: ModuleInstallRequest["mode"] | "exact-release" };

/** The selected release identity checked again before submission; no host path authority is granted here. */
export type ExternalModuleInstaller = (input: {
  workspaceId: string;
  request: InstallationRequest;
  exactReleaseUpdate?: ExactReleaseBaseline;
  release: {
    name: string; origin: "builtin" | "external"; codeDir: string; hash: string;
    git: { repository: string | null; branch: string; commit: string; bundlePath: string } | null;
  };
}) => Promise<ModuleInstallResult>;
