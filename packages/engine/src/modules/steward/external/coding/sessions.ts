import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executionIdSchema } from "./contract.js";
import { codingError, type CodingContext } from "./storage";
import { serializeWork } from "./work-v2-storage";
import { getCodingWork } from "./work";

type Session = { id: string; title: string; workIds: string[]; selectedWorkId: string | null };
type Sessions = { version: 1; selected: string | null; sessions: Session[] };
async function load(context: CodingContext): Promise<Sessions> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(context.dir, "sessions", "index.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, selected: null, sessions: [] }; throw error; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw codingError("conflict", "Invalid coding session journal");
  const value = raw as Sessions;
  if (value.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > 1000 || value.sessions.some(item => !item || typeof item !== "object" || !executionIdSchema.safeParse(item.id).success || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200 || !Array.isArray(item.workIds) || item.workIds.some(id => !executionIdSchema.safeParse(id).success) || new Set(item.workIds).size !== item.workIds.length || item.selectedWorkId !== null && !item.workIds.includes(item.selectedWorkId)) || new Set(value.sessions.map(item => item.id)).size !== value.sessions.length || value.selected !== null && !value.sessions.some(item => item.id === value.selected)) throw codingError("conflict", "Invalid coding session journal");
  return value;
}
/** A coding session is a business collection of work; selection never starts or interrupts execution. */
export function codingSessions(context: CodingContext, raw: unknown) {
  return serializeWork(async () => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw codingError("invalid", "Expected session command");
    const args = raw as Record<string, unknown>, op = args.op;
    const fields: Record<string, string[]> = { list: ["op"], create: ["op", "id", "title"], select: ["op", "id"], bind: ["op", "id", "workId"] };
    if (typeof op !== "string" || !Object.hasOwn(fields, op) || Object.keys(args).some(key => !fields[op]!.includes(key))) throw codingError("invalid", "Invalid session command");
    const journal = await load(context);
    if (op === "list") return journal;
    const parsed = executionIdSchema.safeParse(args.id);
    if (!parsed.success) throw codingError("invalid", "Invalid session identity");
    const id = parsed.data;
    let session = journal.sessions.find(item => item.id === id);
    if (op === "create") {
      if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 200) throw codingError("invalid", "Invalid session title");
      if (session && session.title !== args.title.trim()) throw codingError("conflict", "Session identity already used");
      if (!session) { if (journal.sessions.length >= 1000) throw codingError("capacity", "Coding session capacity reached"); session = { id, title: args.title.trim(), workIds: [], selectedWorkId: null }; journal.sessions.push(session); }
    } else if (!session) throw codingError("not_found", "Coding session not found");
    if (op === "select") journal.selected = id;
    if (op === "bind") {
      const workId = executionIdSchema.safeParse(args.workId);
      if (!workId.success) throw codingError("invalid", "Invalid work identity");
      await getCodingWork(context, { workId: workId.data });
      if (!session!.workIds.includes(workId.data)) session!.workIds.push(workId.data);
      session!.selectedWorkId = workId.data;
    }
    const dir = join(context.dir, "sessions"); await mkdir(dir, { recursive: true });
    const path = join(dir, "index.json"); await writeFile(path + ".next", JSON.stringify(journal), { mode: 0o600 }); await rename(path + ".next", path);
    return journal;
  });
}
