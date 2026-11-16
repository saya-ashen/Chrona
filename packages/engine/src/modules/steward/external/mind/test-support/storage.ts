import { Database } from "bun:sqlite";

/** Inspect the component's owned tables after consolidation into the shared file. */
export function tableBytes(path: string, table: "invocations" | "documents" | "delivery") {
  const db = new Database(path, { readonly: true });
  try { return Buffer.from(JSON.stringify(db.query(`SELECT * FROM "${table}"`).all())); }
  finally { db.close(); }
}
