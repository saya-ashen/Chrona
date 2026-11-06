import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";
import { executorAssignmentSchema, executorFinalSchema } from "@chrona/contracts/steward";
import { assignmentUnit, ExecutorJournal, localDigest } from "./journal";

const freshAssignment = () => executorAssignmentSchema.parse({ ...fixture.assignment, deadlineAt: new Date(Date.now() + 12_000).toISOString() });
test("intent is durable/private and an identity gap cannot relaunch; final survives lost ACK", () => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-test-journal-")), store = new ExecutorJournal(directory), assignment = freshAssignment();
  const value = store.intent(assignment), unit = assignmentUnit(assignment);
  expect(value.journal.phase).toBe("intent");
  expect(store.read(unit)).toEqual(value);
  expect(statSync(join(directory, `${unit}.json`)).mode & 0o777).toBe(0o600);
  expect(() => new ExecutorJournal(directory).intent(assignment)).toThrow("reconcile without relaunch");
  expect(() => store.intent({ ...assignment, incarnation: "replacement-incarnation" })).toThrow("reconcile without relaunch");
  const final = executorFinalSchema.parse({ ...fixture.final, launchDigest: localDigest(assignment), stop: { kind: "unknown", reason: "Observation lost" } });
  const saved = store.final(unit, final);
  expect(new ExecutorJournal(directory).read(unit)).toEqual(saved);
  expect(store.final(unit, final)).toEqual(saved);
  expect(() => store.final(unit, { ...final, missing: !final.missing })).toThrow("immutable");
  const path = join(directory, `${unit}.json`), corrupted = JSON.parse(readFileSync(path, "utf8"));
  corrupted.journal.launchDigest = "0".repeat(64); writeFileSync(path, JSON.stringify(corrupted));
  expect(() => store.read(unit)).toThrow("binding mismatch");
});
test("old formats, symlink/permission violations and oversized metadata reject", () => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-test-journal-")), store = new ExecutorJournal(directory), value = store.intent(freshAssignment());
  const path = join(directory, `${value.unit}.json`);
  writeFileSync(path, JSON.stringify({ ...value, version: 0 })); expect(() => store.read(value.unit)).toThrow();
  writeFileSync(path, " ".repeat(400_000)); expect(() => store.read(value.unit)).toThrow("Unsafe journal");
  writeFileSync(path, JSON.stringify(value)); chmodSync(path, 0o644);
  expect(() => store.read(value.unit)).toThrow("Unsafe journal");
  unlinkSync(path); symlinkSync(join(directory, "absent"), path);
  expect(() => store.read(value.unit)).toThrow("Unsafe journal");
});
