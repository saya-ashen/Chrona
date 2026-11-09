import { z } from "zod";

/** Host paths are registration input only; execution continues to require an opaque projectRef. */
export const projectsInput = z.object({
  action: z.enum(["list", "register", "create"]),
  path: z.string().min(1).max(8192).optional(),
  name: z.string().min(1).max(64).optional(),
}).strict().superRefine((input, ctx) => {
  const valid = input.action === "list" ? input.path === undefined && input.name === undefined
    : input.action === "register" ? input.path !== undefined && input.name === undefined
    : input.name !== undefined && input.path === undefined;
  if (!valid) ctx.addIssue({ code: "custom", message: "list takes no path/name; register requires only path; create requires only name" });
});
const identity = z.string().min(1).max(256);
export const projectPrincipal = z.object({
  workspaceId: identity,
  ownerId: z.literal("owner"),
  caller: z.object({ kind: z.literal("module"), moduleId: identity, hash: identity }).strict(),
}).strict();
export const projectView = z.object({ projectRef: identity, path: z.string().min(1).max(8192), label: z.string().min(1).max(8192) }).strict();
export const projectsOutput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), principal: projectPrincipal, projects: z.array(projectView).max(100) }).strict(),
  z.object({ action: z.literal("register"), principal: projectPrincipal, project: projectView }).strict(),
  z.object({ action: z.literal("create"), principal: projectPrincipal, project: projectView }).strict(),
]);
