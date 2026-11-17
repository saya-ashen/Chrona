import { Database } from "bun:sqlite";

export type StorageLimits = { maxPages: number; admissionPages: number };
const STORAGE_LIMITS: StorageLimits = { maxPages: 32768, admissionPages: 8192 };
class StorageAdmissionError extends Error {
  readonly code = "storage_exhausted";
  constructor(message = "Physical SQLite admission exhausted; retained evidence must not be deleted") { super(message); }
}

type Reserve = { capacity: number; available: number; held: number };
/** Private single-writer database. Kept local to each independently shipped package.
 * DELETE + cache_spill=OFF bounds the rollback journal to original database pages
 * (plus page numbers/sector headers); there is no accumulating WAL/checkpoint debt.
 * A committed zeroblob allocates real reserve pages before admitting an effect.
 * Releasing it converts those pages to measured, transactionally accounted credit.
 * Ordinary writes cannot spend credit, even though SQLite can see the freelist.
 * Credit is never replenished by deleting business evidence. No retention GC.
 */
export class PhysicalStorage {
  readonly pageSize: number;
  constructor(readonly db: Database, readonly limits: StorageLimits = STORAGE_LIMITS) {
    if (!Number.isSafeInteger(limits.maxPages) || !Number.isSafeInteger(limits.admissionPages) || limits.admissionPages < 64 || limits.maxPages <= limits.admissionPages || limits.maxPages > STORAGE_LIMITS.maxPages) throw new Error("Invalid physical SQLite limits");
    const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=DELETE").get()!.journal_mode;
    if (mode !== "delete") throw new Error("Cannot establish bounded SQLite journal mode");
    db.exec("PRAGMA synchronous=EXTRA; PRAGMA journal_size_limit=0; PRAGMA cache_spill=OFF; PRAGMA temp_store=MEMORY; PRAGMA auto_vacuum=NONE");
    this.pageSize = db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
    if (this.pageSize !== 4096) throw new Error("Unsupported SQLite page size");
    const max = db.query<{ max_page_count: number }, []>(`PRAGMA max_page_count=${limits.maxPages}`).get()!.max_page_count;
    if (max !== limits.maxPages) throw new StorageAdmissionError("Retained database already exceeds the physical page ceiling");
    db.exec(`CREATE TABLE IF NOT EXISTS storage_policy(id INTEGER PRIMARY KEY CHECK(id=1),max_pages INTEGER NOT NULL,admission_pages INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS storage_reserves(id TEXT PRIMARY KEY,capacity INTEGER NOT NULL,available TEXT NOT NULL,held INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS storage_reserve_pages(id TEXT PRIMARY KEY,payload BLOB NOT NULL);`);
    db.transaction(() => {
      const prior = db.query<{ max_pages: number; admission_pages: number }, []>("SELECT * FROM storage_policy WHERE id=1").get();
      if (prior && (prior.max_pages !== limits.maxPages || prior.admission_pages !== limits.admissionPages)) throw new Error("Physical storage policy changed; explicit recovery required");
      db.query("INSERT OR IGNORE INTO storage_policy VALUES (1,?,?)").run(limits.maxPages, limits.admissionPages);
      this.reserve("$control", 256);
      this.check();
    }).immediate();
  }
  private used() {
    return this.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count - this.db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count;
  }
  private totals() { return this.db.query<{ capacity: number; available: number }, []>("SELECT COALESCE(SUM(capacity),0) capacity,COALESCE(SUM(available),0) available FROM storage_reserves").get()!; }
  private liability() { return this.used() + this.totals().available; }
  private check(requireBacking = true) {
    const { capacity, available } = this.totals(), pages = this.used() + available;
    const allocated = this.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
    if (pages > this.limits.maxPages || (requireBacking && pages > allocated) || pages - capacity > this.limits.admissionPages) throw new StorageAdmissionError();
  }
  /** Must share the admission transaction. A failed allocation rolls back admission. */
  reserve(id: string, pages: number) {
    if (!this.db.inTransaction) throw new Error("Physical reservation requires an admission transaction");
    if (this.db.query("SELECT 1 FROM storage_reserves WHERE id=?").get(id)) return;
    const before = this.used();
    this.db.query("INSERT INTO storage_reserves VALUES (?,?,'00000000',1)").run(id, pages);
    this.db.query("INSERT INTO storage_reserve_pages VALUES (?,zeroblob(?))").run(id, pages * this.pageSize);
    this.db.query("UPDATE storage_reserves SET capacity=? WHERE id=?").run(this.used() - before, id);
  }
  /** Reoccupy released credits before an ordinary write can commit.
   * It may temporarily use the freelist, but must restore live backing. Keeping the backing blob live at commit also prevents sparse-file
   * 'preallocation' from pages allocated and freed in the same transaction.
   * Blob/index overhead is added to the reservation, never taken from its
   * remaining credit. The hard ceiling can refuse this ordinary transaction.
   */
  private holdCredits() {
    for (const row of this.db.query<{ id: string; available: number }, []>("SELECT id,CAST(available AS INTEGER) available FROM storage_reserves WHERE held=0 AND CAST(available AS INTEGER)>0").all()) {
      const before = this.used();
      this.db.query("INSERT INTO storage_reserve_pages VALUES (?,zeroblob(?))").run(row.id, row.available * this.pageSize);
      const held = this.used() - before;
      if (held < row.available) throw new StorageAdmissionError("Cannot reestablish physical reserve backing");
      this.db.query("UPDATE storage_reserves SET held=1,available='00000000',capacity=capacity+? WHERE id=?").run(held - row.available, row.id);
    }
  }
  write<T>(body: () => T, reserve?: string): T {
    const nested = this.db.inTransaction;
    return this.db.transaction(() => {
      const changes = this.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n;
      const schema = this.db.query<{ schema_version: number }, []>("PRAGMA schema_version").get()!.schema_version;
      if (reserve !== undefined) {
        const row = this.db.query<Reserve, [string]>("SELECT capacity,CAST(available AS INTEGER) available,held FROM storage_reserves WHERE id=?").get(reserve);
        if (!row) throw new StorageAdmissionError("No physical evidence reservation for this identity");
        if (row.held) {
          const before = this.used();
          this.db.query("DELETE FROM storage_reserve_pages WHERE id=?").run(reserve);
          this.db.query("UPDATE storage_reserves SET held=0,available=printf('%08d',?) WHERE id=?").run(row.available + before - this.used(), reserve);
        }
      }
      // Nested evidence writes debit their own credit; their liability is unchanged.
      const before = this.liability(), value = body();
      if (reserve !== undefined) {
        const growth = Math.max(0, this.liability() - before);
        const row = this.db.query<Reserve, [string]>("SELECT capacity,CAST(available AS INTEGER) available,held FROM storage_reserves WHERE id=?").get(reserve)!;
        if (growth > row.available) throw new StorageAdmissionError("Physical evidence reservation exhausted");
        this.db.query("UPDATE storage_reserves SET available=printf('%08d',CAST(available AS INTEGER)-?) WHERE id=?").run(growth, reserve);
      }
      if (reserve === undefined && (this.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n !== changes || this.db.query<{ schema_version: number }, []>("PRAGMA schema_version").get()!.schema_version !== schema)) this.holdCredits();
      // An enclosing admission may still need to reoccupy its credits before
      // the outer COMMIT. A savepoint alone has not promised physical backing.
      this.check(!nested);
      return value;
    }).immediate();
  }
}
