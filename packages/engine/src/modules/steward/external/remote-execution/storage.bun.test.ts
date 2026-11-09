import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhysicalStorage } from "./storage";

test("page ceiling, reserve debit and admission rollback use actual SQLite allocation", () => {
  const root = mkdtempSync(join(tmpdir(), "physical-sqlite-")), path = join(root, "db.sqlite");
  const limits = { maxPages: 512, admissionPages: 64 };
  let db = new Database(path), storage = new PhysicalStorage(db, limits);
  const reserves = () => db.query("SELECT * FROM storage_reserves ORDER BY id").all();
  try {
    storage.write(() => { db.exec("CREATE TABLE retained(id INTEGER PRIMARY KEY,body BLOB)"); storage.reserve("evidence", 64); });
    // Nested cancel/evidence can use a new reserve in the same admission. The
    // enclosing commit must put every unused credit back into live backing.
    storage.write(() => {
      storage.reserve("nested", 8);
      db.query("INSERT INTO retained VALUES (500,zeroblob(4096))").run();
      storage.write(() => db.query("INSERT INTO retained VALUES (501,zeroblob(4096))").run(), "nested");
    });
    expect(db.query("SELECT held FROM storage_reserves WHERE id='nested'").get()).toEqual({ held: 1 });
    const baseline = db.query("SELECT id,length(body) n FROM retained ORDER BY id").all();
    const backing = reserves(), count = db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
    expect(statSync(path).blocks * 512).toBeGreaterThanOrEqual(statSync(path).size * 0.95);
    expect(() => storage.write(() => { db.query("INSERT INTO retained VALUES (1,zeroblob(32768))").run(); throw new Error("before-commit fault"); }, "evidence")).toThrow("before-commit fault");
    expect(reserves()).toEqual(backing); expect(db.query("SELECT id,length(body) n FROM retained ORDER BY id").all()).toEqual(baseline);
    // SQLITE_FULL inside a real write must roll back evidence and blob release.
    expect(() => storage.write(() => db.query("INSERT INTO retained VALUES (2,zeroblob(?))").run(limits.maxPages * 4096), "evidence")).toThrow();
    expect(reserves()).toEqual(backing); expect(db.query("SELECT id,length(body) n FROM retained ORDER BY id").all()).toEqual(baseline);
    expect(() => storage.write(() => storage.reserve("cannot-fit", 512))).toThrow();
    expect(reserves()).toEqual(backing);
    let rows = 0;
    for (;;) {
      try { storage.write(() => db.query("INSERT INTO retained(body) VALUES (zeroblob(4096))").run()); rows++; }
      catch (error) { expect(error).toHaveProperty("code", "storage_exhausted"); break; }
    }
    expect(rows).toBeGreaterThan(10);
    expect(() => storage.write(() => { storage.reserve("ordinary-overflow", 4); db.query("INSERT INTO retained VALUES (999,zeroblob(32768))").run(); })).toThrow();
    expect(db.query("SELECT 1 FROM storage_reserves WHERE id='ordinary-overflow'").get()).toBeNull();
    storage.write(() => db.query("INSERT INTO retained VALUES (1000,zeroblob(32768))").run(), "evidence");
    const credits = reserves();
    // A rejected ordinary transaction cannot steal the newly freed backing.
    expect(() => storage.write(() => db.query("INSERT INTO retained VALUES (2000,zeroblob(32768))").run())).toThrow();
    expect(reserves()).toEqual(credits);
    expect(db.query("SELECT * FROM retained WHERE id=2000").get()).toBeNull();
    db.close(); db = new Database(path); storage = new PhysicalStorage(db, limits);
    expect(reserves()).toEqual(credits);
    expect(db.query("SELECT length(body) n FROM retained WHERE id=1000").get()).toEqual({ n: 32768 });
    storage.write(() => db.query("INSERT INTO retained VALUES (1001,zeroblob(32768))").run(), "evidence");
    expect(db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count).toBeGreaterThanOrEqual(count);
    expect(statSync(path).size).toBeLessThanOrEqual(limits.maxPages * 4096);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(existsSync(`${path}-wal`)).toBe(false); expect(existsSync(`${path}-journal`)).toBe(false);
    expect(() => new PhysicalStorage(db, { ...limits, admissionPages: 65 })).toThrow("policy changed");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("rollback journal stays finite during real commits and legacy WAL is checkpointed on open", async () => {
  const root = mkdtempSync(join(tmpdir(), "bounded-sqlite-journal-")), path = join(root, "db.sqlite");
  const db = new Database(path), limits = { maxPages: 2048, admissionPages: 1536 };
  let worker: Worker | undefined;
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE legacy(value TEXT); INSERT INTO legacy VALUES ('retained')");
    const storage = new PhysicalStorage(db, limits);
    expect(db.query("SELECT * FROM legacy").get()).toEqual({ value: "retained" });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    expect(db.query("PRAGMA cache_spill").get()).toEqual({ cache_spill: 0 });
    expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 3 });
    storage.write(() => { db.exec("CREATE TABLE payload(id INTEGER PRIMARY KEY,body BLOB)"); for (let i = 0; i < 900; i++) db.query("INSERT INTO payload(body) VALUES (zeroblob(4096))").run(); });
    const state = new Int32Array(new SharedArrayBuffer(16));
    // SQLite commit blocks this thread. A separate worker samples real journal
    // bytes concurrently, including the short interval before DELETE removes it.
    const source = `import {statSync} from 'node:fs'; self.onmessage = ({data}) => { const state = new Int32Array(data.buffer); self.postMessage('ready'); while (!Atomics.load(state,0)) { try { const size=statSync(data.path).size; Atomics.store(state,1,Math.max(size,Atomics.load(state,1))); Atomics.add(state,2,1); } catch {} } };`;
    const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    worker = new Worker(url);
    try {
      await new Promise<void>((resolve, reject) => { worker!.onmessage = () => resolve(); worker!.onerror = reject; worker!.postMessage({ buffer: state.buffer, path: `${path}-journal` }); });
      for (let i = 0; i < 3; i++) storage.write(() => db.exec(`UPDATE payload SET body=randomblob(4096)`));
      Atomics.store(state, 0, 1);
      expect(Atomics.load(state, 2)).toBeGreaterThan(0);
      expect(Atomics.load(state, 1)).toBeGreaterThan(3 * 1024 * 1024);
      // One page image per original page, plus 8-byte record headers, with a
      // conservative 64 KiB sector/header allowance. cache_spill stays disabled.
      expect(Atomics.load(state, 1)).toBeLessThanOrEqual(limits.maxPages * (4096 + 8) + 65536);
    } finally { Atomics.store(state, 0, 1); await worker.terminate(); URL.revokeObjectURL(url); }
    expect(existsSync(`${path}-wal`)).toBe(false); expect(existsSync(`${path}-journal`)).toBe(false);
    expect(statSync(path).size).toBeLessThanOrEqual(limits.maxPages * 4096);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
