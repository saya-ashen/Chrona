import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";

type Backend = { get(id: string): unknown; update(id: string, content: string): boolean; forget(id: string): boolean };
type Row = { id: string; content: string | null; source: string; at: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
/** Durable intent precedes index mutation. A failed index repair blocks reads rather than returning stale facts. */
export function corrections(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "corrections.db"), db = new Database(file, { create: true });
  chmodSync(file, 0o600);
  db.exec("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY, content TEXT, source TEXT NOT NULL, at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS superseded(hash TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS blocked_sources(source TEXT PRIMARY KEY);");
  const rows = () => db.query<Row, []>("SELECT id, content, source, at FROM corrections").all();
  function repair(backend: Backend) {
    for (const row of rows()) {
      if (row.content === null) { backend.forget(row.id); if (backend.get(row.id)) throw new Error("Memory deletion could not be applied"); continue; }
      const current = backend.get(row.id) as { content?: unknown } | null;
      if (!current) throw new Error("Corrected memory is missing from index");
      if (current.content !== row.content && !backend.update(row.id, row.content)) throw new Error("Memory correction could not be applied");
    }
  }
  function change(backend: Backend, id: string, { expected, content, source, at }: { expected: string | null; content: string | null; source: string; at: string }) {
    repair(backend);
    const prior = db.query<Row, [string]>("SELECT id, content, source, at FROM corrections WHERE id = ?").get(id);
    if (prior && prior.content === content) return { id, source: prior.source, at: prior.at };
    const current = backend.get(id) as { content?: unknown; source?: unknown } | null;
    if (!current || typeof current.content !== "string") throw new Error("Memory not found");
    if (expected !== null && current.content !== expected) throw new Error("Memory changed; recall before correcting");
    if (content === current.content) return { id, source, at };
    if (content !== null && db.query("SELECT 1 FROM superseded WHERE hash = ?").get(digest(content))) throw new Error("Previously superseded content cannot be restored");
    db.transaction(() => {
      if ((db.query("SELECT count(*) AS count FROM superseded").get() as { count: number }).count >= 8192) throw new Error("Memory supersession journal is full");
      if (rows().length >= 4096 && !prior) throw new Error("Memory correction journal is full");
      db.query("INSERT OR IGNORE INTO superseded VALUES (?)").run(digest(current.content as string));
      if (typeof current.source === "string" && current.source.startsWith("conversation:")) db.query("INSERT OR IGNORE INTO blocked_sources VALUES (?)").run(current.source);
      db.query("INSERT INTO corrections VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content=excluded.content, source=excluded.source, at=excluded.at").run(id, content, source, at);
    })();
    repair(backend);
    return { id, source, at };
  }
  return {
    repair,
    sourceBlocked: (source: string) => !!db.query("SELECT 1 FROM blocked_sources WHERE source = ?").get(source),
    provenance(backend: Backend, id: string) {
      const original = backend.get(id) as { source?: unknown } | null;
      const correction = db.query<Row, [string]>("SELECT id, content, source, at FROM corrections WHERE id = ?").get(id);
      return { source: typeof original?.source === "string" ? original.source : null, correction: correction ? { source: correction.source, at: correction.at } : null };
    },
    correct: (...[backend, id, expected, content, source, at]: [backend: Backend, id: string, expected: string, content: string, source: string, at: string]) => change(backend, id, { expected, content, source, at }),
    forget: (backend: Backend, id: string, source: string, at: string) => { change(backend, id, { expected: null, content: null, source, at }); return { forgotten: true }; },
    checkRetention(content: string) {
      if (db.query("SELECT 1 FROM superseded WHERE hash = ?").get(digest(content))) throw new Error("Memory content was corrected or deleted; automatic retention refused");
    },
    close: () => db.close(),
  };
}
