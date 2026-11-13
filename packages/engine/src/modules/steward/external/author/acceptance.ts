import { createHash } from "node:crypto";
import type { Prepare } from "./contracts";

/** A write-ready worksheet, not verified evidence or an approval/continuation engine. */
export function acceptanceMaterial(input: Prepare) {
  const workspace = createHash("sha256").update(JSON.stringify([input.requestKey, input.targets])).digest("hex").slice(0, 24);
  const checks = [
    ["minimal-real-integration", "real-host"],
    ["candidate-check", "candidate"],
    ["installation-approval", "candidate"],
    ["activation", "real-host"],
    ["functional", "fixture"],
    ["functional", "real-host"],
    ["visual", "real-host"],
  ];
  return {
    path: `sources/acceptance-${workspace}/checklist.json`,
    content: `${JSON.stringify({
      requestKey: input.requestKey,
      goal: input.goal,
      targets: input.targets,
      // Keep the worksheet outside submitted material: later observations must not mutate a candidate.
      admissionId: null,
      receiptId: null,
      continuation: { responsible: null, nextAction: "Complete outstanding real-host functional and visual acceptance for the exact active version after approval.", blocker: null },
      checks: input.targets.flatMap(target => checks.map(([kind, environment]) => ({
        target: target.name,
        kind,
        environment,
        status: "not-run",
        moduleId: target.moduleId,
        candidateHash: null,
        activeHash: null,
        hostVersion: null,
        provider: "unknown",
        scenario: null,
        expected: null,
        observed: null,
        evidence: [],
        reason: null,
        reviewer: null,
      }))),
    }, null, 2)}\n`,
  };
}
