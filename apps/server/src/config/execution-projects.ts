import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { CallError } from "@chrona/kernel";
import { executionIdSchema, executionHostBaselineSchema, localExecutionProjectGrantSchema, type ExecutionPrincipal, type ExecutionProjectGrant, type LocalExecutionProjectGrant, type WorkPlacement } from "@chrona/contracts/steward";

const projectSchema = z.object({
  workspaceId: executionIdSchema, ownerId: executionIdSchema, moduleId: executionIdSchema,
  projectRef: executionIdSchema, canonicalPath: z.string().min(1).refine(path => isAbsolute(path) && normalize(path) === path, "Expected normalized absolute host path"),
  baseline: executionHostBaselineSchema,
}).strict();
const placementSchema = z.object({ workspaceId: executionIdSchema, ownerId: executionIdSchema, moduleId: executionIdSchema, grant: localExecutionProjectGrantSchema }).strict()
  .refine(value => isAbsolute(value.grant.canonicalPath) && normalize(value.grant.canonicalPath) === value.grant.canonicalPath, "Invalid local execution mapping");
const configSchema = z.object({ projects: z.array(projectSchema).max(100), placements: z.array(placementSchema).max(100).optional() }).strict();

/** Owner-only <dataDir>/execution-projects.json. Parsing never scans, opens or authorizes a project directory. */
export function parseExecutionProjects(raw: unknown) {
  const { projects } = configSchema.parse(raw);
  const keys = new Set<string>();
  for (const project of projects) {
    const key = JSON.stringify([project.workspaceId, project.ownerId, project.moduleId, project.projectRef]);
    if (keys.has(key)) throw new Error("Duplicate execution project mapping");
    keys.add(key);
  }
  return async (principal: ExecutionPrincipal, projectRef: string): Promise<ExecutionProjectGrant> => {
    const project = projects.find(project => project.workspaceId === principal.workspaceId && project.ownerId === principal.ownerId
      && principal.caller.kind === "module" && project.moduleId === principal.caller.moduleId && project.projectRef === projectRef);
    if (!project) throw new Error("Execution project is not configured for this caller");
    return { projectRef: project.projectRef, executor: "server", canonicalPath: project.canonicalPath, baseline: project.baseline };
  };
}

/** Local placements are owner configured; remote application placements use kernel authority approvals. */
export function parseExecutionPlacements(raw: unknown) {
  const { placements = [] } = configSchema.parse(raw);
  const keys = new Set<string>();
  for (const { workspaceId, ownerId, moduleId, grant } of placements) {
    const key = JSON.stringify([workspaceId, ownerId, moduleId, grant.executorId, grant.projectRef]);
    if (keys.has(key)) throw new Error("Duplicate P2 project mapping");
    keys.add(key);
  }
  const resolve = async (principal: ExecutionPrincipal, placement: WorkPlacement): Promise<LocalExecutionProjectGrant> => {
    const item = placements.find(item => item.workspaceId === principal.workspaceId && item.ownerId === principal.ownerId
      && principal.caller.kind === "module" && item.moduleId === principal.caller.moduleId
      && item.grant.executorId === placement.executorId && item.grant.projectRef === placement.projectRef && item.grant.mappingRevision === placement.mappingRevision);
    if (!item) throw new CallError("forbidden", "P2 project mapping is not configured for this caller or revision");
    return structuredClone(item.grant);
  };
  return Object.assign(resolve, {
    async list(principal: ExecutionPrincipal): Promise<WorkPlacement[]> {
      return placements.filter(item => item.workspaceId === principal.workspaceId && item.ownerId === principal.ownerId
        && principal.caller.kind === "module" && item.moduleId === principal.caller.moduleId)
        .map(({ grant }) => ({ executorId: grant.executorId, projectRef: grant.projectRef, mappingRevision: grant.mappingRevision }));
    },
  });
}

/** Loaded by runtime initialization, outside admission/claim writer transactions. */
export async function loadExecutionPlacements(dataDir: string) {
  let text: string;
  try { text = await readFile(join(dataDir, "execution-projects.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return parseExecutionPlacements(JSON.parse(text));
}

/** Absence disables resolution; malformed owner configuration fails startup rather than becoming an empty allowlist. */
export async function loadExecutionProjects(dataDir: string) {
  let text: string;
  try { text = await readFile(join(dataDir, "execution-projects.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return parseExecutionProjects(JSON.parse(text));
}
