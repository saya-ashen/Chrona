import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreMindStore } from "./core-store";
import { CoreMindService } from "./core-service";
import { CoreNotifications } from "./core-notifications";
import type { CoreCall } from "./core-execution";
import type { CoreAccess, CoreSettings, Pursuit } from "./core-types";

const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };
const runtime: CoreAccess = { subject: "adapter", role: "runtime", scopes: [{}], execution: { actor: "mind", runRef: "run-1" } };
const noon = "2026-11-13T12:00:00.000Z";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const f of cleanup.splice(0)) await f(); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "mind-notifications-test-"));
  const store = new CoreMindStore(directory);
  let now = noon;
  const service = new CoreMindService(store, { now: () => now });
  const calls: Array<{ target: unknown; args: Record<string, unknown>; key?: string }> = [];
  const receipts = new Map<string, string>();
  let loseReply = false;
  let hook: (() => void) | undefined;
  const call: CoreCall = async (target, args, options) => {
    calls.push({ target, args, key: options?.key }); hook?.();
    const key = args.key as string, duplicate = receipts.has(key);
    if (!duplicate) receipts.set(key, `receipt-${receipts.size}`);
    if (loseReply) throw new Error("injected lost reply containing private data");
    return { id: receipts.get(key), status: "queued", duplicate };
  };
  let adapter = new CoreNotifications(store, call, () => "actual-notify-module-id");
  cleanup.push(async () => { await adapter.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  function settings(patch: Partial<Omit<CoreSettings, "revision" | "restoreBlocked">>) {
    const state = store.read(); service.settings({ actionKey: `settings-${state.revision}`, expectedRevision: state.settings.revision, expectedVisibilityRevision: state.visibilityRevision, patch }, owner);
  }
  function result(key: string, actor = "mind"): Pursuit {
    const access = { ...runtime, execution: { actor, runRef: `run-${key}` } };
    const visibility = store.read().visibilityRevision;
    const p = service.pursue({ actionKey: `goal-${key}`, expectedVisibilityRevision: visibility, expectedRevision: 0, semanticKey: key, goal: `private goal ${key}`, completionCriteria: ["result is usable"], scope: {}, reason: "explicit-goal", evidenceRefs: [] }, owner).value!;
    const claimed = service.claim({ actionKey: `claim-${key}`, expectedVisibilityRevision: visibility, expectedRevision: p.revision, pursuitId: p.id }, access).value!;
    const c = service.progress({ actionKey: `progress-${key}`, expectedVisibilityRevision: visibility, expectedRevision: claimed.revision, pursuitId: p.id, summary: `private summary ${key}`, artifactRefs: [`artifact:${key}`], originalReceiptRef: `effect:${key}`, evidenceRefs: p.evidenceRefs, desiredStatus: "done" }, access).value!;
    return service.applyProgress({ actionKey: `apply-${key}`, expectedVisibilityRevision: visibility, expectedRevision: claimed.revision, candidateId: c.id, verified: { candidateReceipt: c.receipt, runRef: c.runRef, originalReceiptRef: c.originalReceiptRef, artifactRefs: c.artifactRefs, method: "opened actual test artifact", criteriaSatisfied: true, executionTerminal: true } }, runtime).value!.pursuit;
  }
  return { directory, store, service, calls, receipts, result, settings,
    get adapter() { return adapter; }, setNow(v: string) { now = v; },
    lose(v: boolean) { loseReply = v; }, hook(f: () => void) { hook = f; },
    async reopen(resolve: () => string | undefined | Promise<string | undefined> = () => "changed-directory-id") { await adapter.close(); adapter = new CoreNotifications(store, call, resolve); return adapter; } };
}

type EvidenceLink = "direct" | "supporting" | "opposing";
type CoverageFailure = "missing" | "gap" | "epoch" | "scope" | "flagged-gap";
function sourcedResult(f: ReturnType<typeof setup>, key: string, link: EvidenceLink) {
  const p = f.result(key), sourceIdentity = `chat-${key}`;
  const checkpoint = { id: sourceIdentity, revision: 1, sourceIdentity, epoch: "epoch-1", cursor: "10", scopeRevision: 3, capturedAt: noon, coverage: { complete: true } };
  f.store.update(tx => {
    const ownerEvidence = tx.get("evidence", p.evidenceRefs[0]!)!;
    const evidence = { ...ownerEvidence, id: link === "direct" ? ownerEvidence.id : `source-evidence-${key}`, sourceIdentity, epoch: checkpoint.epoch, scopeRevision: checkpoint.scopeRevision };
    tx.put("evidence", evidence);
    tx.put("checkpoint", checkpoint);
    if (link !== "direct") {
      const id = `understanding-${key}`;
      tx.put("understanding", { id, revision: 1, createdAt: noon, updatedAt: noon, kind: "preference", value: "source-dependent preference", scope: {}, explicitness: "explicit",
        supportingRefs: [link === "supporting" ? evidence.id : ownerEvidence.id], opposingRefs: link === "opposing" ? [evidence.id] : [], status: "active", visibilityRevision: 0 });
      tx.put("pursuit", { ...p, understandingRefs: [id] });
    }
  });
  return {
    p,
    coverage(failure?: CoverageFailure) {
      f.store.update(tx => {
        if (failure === "missing") { tx.delete("checkpoint", checkpoint.id); return; }
        tx.put("checkpoint", { ...checkpoint, revision: (tx.get("checkpoint", checkpoint.id)?.revision ?? 0) + 1,
          epoch: failure === "epoch" ? "epoch-2" : checkpoint.epoch,
          scopeRevision: failure === "scope" ? 4 : checkpoint.scopeRevision,
          coverage: failure === "gap" ? { complete: false, gap: "source_rebuilding" } : failure === "flagged-gap" ? { complete: true, gap: "source_rebuilding" } : { complete: true } });
      });
    },
  };
}

describe("Mind bounded notification adapter", () => {
  for (const link of ["direct", "supporting", "opposing"] as const) {
    test.each(["missing", "gap", "epoch", "scope", "flagged-gap"] as const)(`${link} evidence requires current complete coverage (%s) before discovery and after async resolution`, async failure => {
      const f = setup(); f.settings({ notifyEnabled: true });
      const source = sourcedResult(f, `coverage-${link}-${failure}`, link);
      source.coverage(failure);
      let view = await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(0);
      expect(view.suppressed).toContainEqual({ pursuitId: source.p.id, reason: link === "direct" ? "evidence-unavailable" : "understanding-unavailable" });
      source.coverage();
      await f.reopen(async () => { source.coverage(failure); return "notify-id"; });
      view = await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(0);
      expect(view.stalePending).toBe(1);
      source.coverage();
      await f.reopen();
      await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(1);
    });

    test.each(["missing", "gap", "epoch", "scope"] as const)(`${link} evidence holds a lost-response retry during %s and recovers the same request when coverage returns`, async failure => {
      const f = setup(); f.settings({ notifyEnabled: true });
      const source = sourcedResult(f, `retry-${link}-${failure}`, link);
      f.lose(true);
      await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(1);
      source.coverage(failure);
      f.lose(false); await f.reopen();
      const held = await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(1);
      expect(held.unresolved).toBe(1); expect(held.held).toHaveLength(1);
      source.coverage();
      const recovered = await f.adapter.sync(noon);
      expect(f.calls).toHaveLength(2); expect(f.calls[1]).toEqual(f.calls[0]);
      expect(f.receipts.size).toBe(1); expect(recovered.unresolved).toBe(0);
    });
  }

  test("coverage lost during an earlier send prevents subsequent immediate and digest sends", async () => {
    const f = setup(); f.settings({ notifyEnabled: true });
    const sources = [sourcedResult(f, "first-send", "direct"), sourcedResult(f, "second-send", "supporting"), sourcedResult(f, "digest-send", "opposing")];
    // Core records sort by generated ID. Revoke every source during whichever send
    // runs first, so later sends must validate the newly committed coverage.
    f.hook(() => { for (const source of sources) source.coverage("gap"); });
    const view = await f.adapter.sync(noon);
    expect(f.calls).toHaveLength(1); expect(view.receipts).toHaveLength(1);
    expect(view.suppressed.map(s => s.pursuitId).sort()).toEqual(sources.map(s => s.p.id).sort());
  });

  test.each(["direct", "supporting", "opposing"] as const)("digest retry checks coverage for every member's %s evidence", async link => {
    const f = setup(); f.settings({ notifyEnabled: true });
    sourcedResult(f, "covered-digest-member", "direct");
    const changed = sourcedResult(f, `changed-digest-member-${link}`, link);
    await f.adapter.sync("2026-11-13T23:00:00Z");
    f.lose(true);
    await f.adapter.sync("2026-11-14T08:00:00Z");
    expect(f.calls).toHaveLength(1); expect(f.calls[0]?.args.level).toBe("digest");
    changed.coverage("gap");
    f.lose(false); await f.reopen();
    const held = await f.adapter.sync("2026-11-14T08:00:00Z");
    expect(f.calls).toHaveLength(1); expect(held.held).toHaveLength(1);
    changed.coverage();
    const recovered = await f.adapter.sync("2026-11-14T08:00:00Z");
    expect(f.calls).toHaveLength(2); expect(f.calls[1]).toEqual(f.calls[0]);
    expect(f.receipts.size).toBe(1); expect(recovered.unresolved).toBe(0);
  });

  test("default is web-only, no resolver or outbound effects; enabling later discovers the result", async () => {
    const f = setup(), p = f.result("default");
    let resolutions = 0;
    await f.reopen(() => { resolutions++; return "notify-id"; });
    expect((await f.adapter.sync(noon)).enabled).toBe(false);
    expect(f.calls).toHaveLength(0); expect(resolutions).toBe(0);
    expect(f.store.read().pursuits.find(v => v.id === p.id)?.status).toBe("done");
    f.settings({ notifyEnabled: true });
    const view = await f.adapter.sync(noon);
    expect(f.calls).toHaveLength(1); expect(view.receipts[0]?.delivery).toBe("unknown");
    expect(view.receipts[0]?.notifyStatus).toBe("queued");
    expect(f.calls[0]?.target).toEqual({ moduleId: "notify-id", tool: "send" });
    expect(f.calls[0]?.args.responds).toBe(false); expect(f.calls[0]?.args.urgent).toBe(false);
    await f.adapter.sync("2026-11-14T12:00:00Z"); expect(f.calls).toHaveLength(1);
  });

  test("five immediate and one substantive digest per local day survives restart; overflow stays visible", async () => {
    const f = setup(); f.settings({ notifyEnabled: true });
    for (let i = 0; i < 12; i++) f.result(`cap-${i}`);
    const view = await f.adapter.sync(noon);
    expect(f.calls.filter(c => c.args.level === "now")).toHaveLength(5);
    expect(f.calls.filter(c => c.args.level === "digest")).toHaveLength(1);
    expect(f.calls.every(c => typeof c.args.body === "string" && c.args.body.length > 20 && c.args.body.length <= 4000)).toBe(true);
    expect(view.pending).toBe(4); expect(f.store.read().pursuits).toHaveLength(12);
    await f.reopen(); await f.adapter.sync(noon); expect(f.calls).toHaveLength(6);
    await f.adapter.sync("2026-11-14T12:00:00Z"); expect(f.calls).toHaveLength(10);
  });

  test("23–08 quiet hours use configured timezone; quiet outcomes become one digest", async () => {
    const f = setup(); f.settings({ notifyEnabled: true, timezone: "Asia/Shanghai" }); f.result("quiet");
    expect((await f.adapter.sync("2026-11-13T15:00:00Z")).quiet).toBe(true);
    expect(f.calls).toHaveLength(0);
    await f.reopen(); await f.adapter.sync("2026-11-13T23:59:00Z"); expect(f.calls).toHaveLength(0);
    await f.adapter.sync("2026-11-14T00:00:00Z");
    expect(f.calls).toHaveLength(1); expect(f.calls[0]?.args.level).toBe("digest");
  });

  test("the live clock is rechecked when module resolution crosses into quiet hours", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("clock-boundary");
    const clock = spyOn(Date, "now").mockReturnValue(Date.parse(noon));
    try {
      await f.reopen(async () => { clock.mockReturnValue(Date.parse("2026-11-13T23:00:00Z")); return "notify-id"; });
      expect((await f.adapter.sync()).quiet).toBe(true); expect(f.calls).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });

  test("quiet pending results survive reconciled responsibility release without duplicating the outcome", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result("released-quiet");
    await f.adapter.sync("2026-11-13T23:00:00Z");
    f.service.release({ actionKey: "release-quiet", expectedVisibilityRevision: 0, expectedRevision: p.revision,
      pursuitId: p.id, runRef: p.currentActor!.runRef, executionStopped: true, effectsReconciled: true }, runtime);
    await f.reopen(); await f.adapter.sync("2026-11-14T08:00:00Z");
    expect(f.calls).toHaveLength(1); expect(f.calls[0]?.args.level).toBe("digest");
    await f.adapter.sync("2026-11-15T08:00:00Z"); expect(f.calls).toHaveLength(1);
  });

  test("lost replies retain exact intent and module identity across restart; effect occurs once", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("lost"); f.lose(true);
    expect((await f.adapter.sync(noon)).unresolved).toBe(1);
    expect(f.receipts.size).toBe(1); f.lose(false);
    await f.reopen(); const view = await f.adapter.sync(noon);
    expect(f.calls).toHaveLength(2); expect(f.calls[1]).toEqual(f.calls[0]);
    expect(f.receipts.size).toBe(1); expect(view.unresolved).toBe(0);
    expect(view.receipts[0]?.delivery).toBe("unknown");
  });

  test("forget while a reply is missing holds the original key without sending old text or new identity", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result("forgotten-secret"); f.lose(true);
    await f.adapter.sync(noon); const e = f.store.read().evidence.find(e => p.evidenceRefs.includes(e.id))!;
    f.service.forget({ actionKey: "forget", expectedVisibilityRevision: 0, target: { kind: "evidence", id: e.id } }, owner);
    await f.reopen(); f.lose(false);
    const view = await f.adapter.sync(noon);
    expect(f.calls).toHaveLength(1); expect(view.unresolved).toBe(1); expect(view.held).toHaveLength(1);
    for (const file of readdirSync(f.directory).filter(v => v.startsWith("mind-notifications"))) {
      const bytes = readFileSync(join(f.directory, file)).toString();
      expect(bytes).not.toContain("forgotten-secret"); expect(bytes).not.toContain("private goal"); expect(bytes).not.toContain("private summary");
    }
    expect(statSync(f.adapter.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(f.directory).some(v => v.startsWith("mind-notifications") && v.endsWith("-wal"))).toBe(false);
  });

  test.each(["revision", "artifact", "evidence", "visibility"])("revalidates %s after async module resolution before dispatch", async field => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result(`race-${field}`);
    await f.reopen(async () => {
      f.store.update(tx => {
        const current = tx.get("pursuit", p.id)!;
        if (field === "revision") { current.revision++; tx.put("pursuit", current); }
        if (field === "artifact") { current.artifactRefs = ["changed-artifact"]; tx.put("pursuit", current); }
        if (field === "evidence") { const e = tx.get("evidence", p.evidenceRefs[0]!)!; e.revision++; e.retractedAt = noon; delete e.content; tx.put("evidence", e); }
        if (field === "visibility") tx.setMeta({ ...tx.meta(), visibilityRevision: 1 });
      });
      return "notify-id";
    });
    await f.adapter.sync(noon); expect(f.calls).toHaveLength(0);
  });

  test("reject suppresses the topic for 30 days; explicit restart restores it, silence never creates a reply", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result("rejected");
    f.service.feedback({ actionKey: "reject", expectedVisibilityRevision: 0, expectedRevision: p.revision, targetKind: "pursuit", targetId: p.id, value: "reject", scope: {} }, owner);
    let view = await f.adapter.sync(noon);
    expect(view.suppressed.some(s => s.reason === "topic-rejected-30-days")).toBe(true); expect(f.calls).toHaveLength(0);
    await f.adapter.sync("2026-12-12T12:00:00Z"); expect(f.calls).toHaveLength(0);
    f.setNow("2026-12-12T13:00:00Z");
    const stopped = f.store.read().pursuits.find(v => v.id === p.id)!;
    const released = f.service.release({ actionKey: "release-rejected", expectedVisibilityRevision: 0, expectedRevision: stopped.revision,
      pursuitId: p.id, runRef: stopped.currentActor!.runRef, executionStopped: true, effectsReconciled: true }, runtime).value!;
    f.service.feedback({ actionKey: "restart", expectedVisibilityRevision: 0, expectedRevision: released.revision, targetKind: "pursuit", targetId: p.id, value: "restart", scope: {} }, owner);
    view = await f.adapter.sync("2026-12-12T13:00:00Z"); expect(view.receipts).toHaveLength(1);
    expect(f.calls[0]?.args.responds).toBe(false);
  });

  test("same outcome delivered by Chat and repeated explicit useless feedback suppress outbound", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("chat-result", "chat"); const p = f.result("useless");
    for (let i = 0; i < 2; i++) {
      f.setNow(`2026-11-13T12:0${i}:00Z`);
      f.service.feedback({ actionKey: `useless-${i}`, expectedVisibilityRevision: 0, expectedRevision: p.revision, targetKind: "pursuit", targetId: p.id, value: "not-useful", scope: {} }, owner);
    }
    const view = await f.adapter.sync(noon); expect(f.calls).toHaveLength(0);
    expect(view.suppressed.map(v => v.reason).sort()).toEqual(["answered-in-chat", "repeated-not-useful"]);
  });

  test("original receipt recovery works when Notify directory lookup is unavailable", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("directory-lost"); f.lose(true);
    await f.adapter.sync(noon); f.lose(false); await f.reopen(() => undefined);
    const view = await f.adapter.sync(noon);
    expect(view.unresolved).toBe(0); expect(f.calls).toHaveLength(2);
    expect(f.calls[1]?.target).toEqual(f.calls[0]?.target);
    expect(f.calls[1]?.key).toBe(f.calls[0]?.key);
  });

  test("pending intent is committed before send and can be observed through a second connection", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("durable-intent");
    let observed: CoreNotifications | undefined;
    f.hook(() => {
      observed = new CoreNotifications(f.store, async () => { throw new Error("observer never sends"); }, () => undefined);
      const view = observed.view(noon);
      expect(view.unresolved).toBe(1); expect(view.receipts).toHaveLength(0);
    });
    await f.adapter.sync(noon); await observed!.close();
    expect(f.calls[0]?.args.key).toBe(f.calls[0]?.key);
  });

  test("unresolved keys consume the next day's budget before fresh outcomes", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.lose(true);
    for (let i = 0; i < 8; i++) f.result(`unknown-cap-${i}`);
    await f.adapter.sync(noon); expect(f.receipts.size).toBe(6);
    for (let i = 0; i < 4; i++) f.result(`fresh-cap-${i}`);
    f.lose(false); await f.reopen();
    await f.adapter.sync("2026-11-14T12:00:00Z");
    expect(f.receipts.size).toBe(6); expect(f.calls).toHaveLength(12);
    await f.adapter.sync("2026-11-14T12:10:00Z"); expect(f.calls).toHaveLength(12);
    expect(f.adapter.view("2026-11-14T12:10:00Z").pending).toBe(4);
  });

  test("quiet pending content is never sent after forget; a fresh result remains web-visible", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result("queued-forget");
    await f.adapter.sync("2026-11-13T23:00:00Z");
    f.service.forget({ actionKey: "forget-queued", expectedVisibilityRevision: 0, target: { kind: "evidence", id: p.evidenceRefs[0]! } }, owner);
    await f.reopen(); const view = await f.adapter.sync("2026-11-14T08:00:00Z");
    expect(f.calls).toHaveLength(0); expect(view.pending).toBe(0); expect(view.stalePending).toBe(1);
    expect(f.store.read().pursuits.find(v => v.id === p.id)?.goal).toBe("");
  });

  test("reject expires exactly after thirty days without interpreting silence as feedback", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); const p = f.result("reject-expiry");
    f.service.feedback({ actionKey: "reject-expiry", expectedVisibilityRevision: 0, expectedRevision: p.revision, targetKind: "pursuit", targetId: p.id, value: "reject", scope: {} }, owner);
    // A separate verified pursuit of the same semantic topic must inherit the rejection window.
    const sibling = { ...p, id: "same-topic-sibling", revision: 1 }; delete sibling.currentActor;
    f.store.update(tx => tx.put("pursuit", sibling));
    await f.adapter.sync("2026-12-13T11:59:59Z"); expect(f.calls).toHaveLength(0);
    await f.adapter.sync("2026-12-13T12:00:00Z"); expect(f.calls).toHaveLength(1);
    await f.adapter.sync("2026-12-14T12:00:00Z"); expect(f.calls).toHaveLength(1);
    expect(f.store.read().feedback).toHaveLength(1);
  });

  test("concurrent sync shares one pass; disabling during resolution prevents any send", async () => {
    const f = setup(); f.settings({ notifyEnabled: true }); f.result("disabled-race");
    await f.reopen(async () => { f.settings({ notifyEnabled: false }); return "notify-id"; });
    const a = f.adapter.sync(noon), b = f.adapter.sync(noon); expect(a).toBe(b);
    await a; expect(f.calls).toHaveLength(0);
  });
});
