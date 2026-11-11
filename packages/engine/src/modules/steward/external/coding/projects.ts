import { basename, join, resolve } from "node:path";
import { codingError, type CodingContext } from "./storage";
import { digest } from "./mutations";
import { saveSessionFile } from "./sessions";
import { codingProjectDirectory, createManagedProjectDirectory, readProjectRegistry, verifyCodingProject, verifyManagedProject, type CodingProject } from "./project-registry";

export { resolveProjectRow as resolveProject } from "./project-registry";

const view = ({ projectRef, path, label }: CodingProject): CodingProject => ({ projectRef, path, label });
/** Project selection is Coding data. It does not change the kernel's cwd or grant filesystem authority. */
export async function listProjects(context: CodingContext): Promise<CodingProject[]> {
  return (await readProjectRegistry(context)).map(view);
}
/** The command service serializes registry updates together with durable mutation receipts. */
export async function mutateProject(context: CodingContext, input: { action: "create"; name: string } | { action: "register"; path: string }): Promise<CodingProject> {
  if (input.action === "create" && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.name)) throw codingError("invalid", "Invalid project name");
  const projects = await readProjectRegistry(context);
  const path = input.action === "create" ? join(resolve(context.dir), "managed-projects", input.name) : (await codingProjectDirectory(input.path)).path;
  const previous = projects.find(item => item.path === path);
  if (previous) {
    if (input.action === "create") await verifyManagedProject(context, previous);
    else await verifyCodingProject(previous);
    return view(previous);
  }
  if (projects.length >= 100) throw codingError("capacity", "Coding project registry is full");
  const directory = input.action === "create" ? await createManagedProjectDirectory(context, input.name) : await codingProjectDirectory(path);
  const project = { projectRef: `project-${digest(path)}`, ...directory, label: basename(path) || path };
  await verifyCodingProject(project);
  projects.push(project); await saveSessionFile(context, "projects.json", projects);
  return view(project);
}
