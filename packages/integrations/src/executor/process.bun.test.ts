import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";
import { executorAssignmentSchema } from "@chrona/contracts/steward";
import { ExecutorJournal, localDigest } from "./journal";
import { observeExecutorStop, recoverExecutorProcess } from "./process";

test("same invocation manager terminal proves stop; running descendants and lost identity do not", () => {
  const store = new ExecutorJournal(mkdtempSync(join(tmpdir(), "chrona-test-observe-")));
  const value = store.intent(executorAssignmentSchema.parse(fixture.assignment));
  value.journal.identity = { bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), unit: value.unit, invocationId: "d".repeat(32), controlGroup: "/user.slice/fixture" };
  value.journal.phase = "owned";
  const properties = { Id: value.unit, InvocationID: value.journal.identity.invocationId, ExitType: "cgroup", RemainAfterExit: "yes", KillMode: "control-group", MainPID: "0", ActiveState: "active", SubState: "running", ControlGroup: "/user.slice/fixture" };
  expect(observeExecutorStop(value, properties)).toBeNull();
  const observation = observeExecutorStop(value, { ...properties, SubState: "exited", ControlGroup: "" })!;
  expect(observation.digest).toBe(localDigest({ assignmentId: observation.assignmentId, launchDigest: observation.launchDigest, identity: observation.identity, observedAt: observation.observedAt, properties: observation.properties }));
  for (const change of [{ InvocationID: "e".repeat(32) }, { ExitType: "main" }, { RemainAfterExit: "no" }, { ActiveState: "inactive", SubState: "dead" }, { ControlGroup: "/other" }]) expect(() => observeExecutorStop(value, { ...properties, ...change })).toThrow();
  value.journal.identity.bootId = "00000000-0000-4000-8000-000000000001";
  expect(() => observeExecutorStop(value, properties)).toThrow();
});

test("entry removes manager environment and preserves explicitly named values without argv values", () => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-test-entry-")), ready = join(directory, "ready"), target = join(directory, "fixture.ts");
  const sentinel = randomUUID(), allowed = randomUUID();
  writeFileSync(ready, "");
  writeFileSync(target, `console.log(JSON.stringify({unknownAbsent:!('CHRONA_EXECUTOR_MANAGER_SENTINEL' in process.env),allowed:process.env.CHRONA_ALLOWED,argv:process.argv.slice(2)}))`);
  const args = [join(import.meta.dir, "process-entry.ts"), JSON.stringify(["CHRONA_ALLOWED"]), ready, process.execPath, target];
  expect(args.join(" ")).not.toContain(allowed);
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { CHRONA_EXECUTOR_MANAGER_SENTINEL: sentinel, CHRONA_ALLOWED: allowed }, timeout: 3000 });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ unknownAbsent: true, allowed, argv: [] });
});

test("recovery never relaunches an intent or fabricates a missing observation", () => {
  const store = new ExecutorJournal(mkdtempSync(join(tmpdir(), "chrona-test-recover-")));
  const value = store.intent(executorAssignmentSchema.parse(fixture.assignment));
  expect(recoverExecutorProcess(store, value.unit).state).toBe("unknown");
  expect(store.read(value.unit)?.journal.identity).toBeNull();
  expect(() => store.intent(value.journal.assignment)).toThrow("reconcile without relaunch");
});
