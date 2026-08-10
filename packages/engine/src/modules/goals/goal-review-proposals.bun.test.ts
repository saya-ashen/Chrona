import { describe, expect, it } from "bun:test";

const source = await Bun.file(`${import.meta.dir}/goal-review-proposals.ts`).text();

function bodyAfter(signature: string) {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe("Goal Review proposal lifecycle source contract", () => {
  it("links each queued run as the proposal generation pointer with a state-version CAS", () => {
    const queue = bodyAfter("async function queueReviewRun");
    const queued = bodyAfter("async function linkQueuedReviewRun");

    expect(queue).toContain("startAiFeatureWithRuntime");
    expect(queued).toContain("queueReviewRun(proposal, operation)");
    expect(queued).toContain("stateVersion: proposal.stateVersion");
    expect(queued).toContain("stateVersion: { increment: 1 }");
  });


  it("attaches concurrent idempotent generation calls to the canonical proposal", () => {
    const generation = bodyAfter("export async function generateGoalReview");

    expect(generation).toContain("isUniqueConstraintError(cause)");
    expect(generation).toContain("const concurrent = await db.goalReviewProposal.findUnique({ where: identity })");
    expect(generation).toContain("if (!concurrent) throw cause");
    expect(generation).toContain("return eventFor(concurrent)");
  });
  it("commits completed reviews atomically as Ready items and the terminal feature run", async () => {
    const feature = await Bun.file(`${import.meta.dir}/ai/goal.review.ts`).text();
    const committer = feature.slice(feature.indexOf("commitResult: async"));

    expect(committer).toContain("await db.$transaction(async (tx) =>");
    expect(committer).toContain('status: "Ready"');
    expect(committer).toContain("tx.goalReviewProposalItem.createMany");
    expect(committer).toContain("commitAiFeatureRunAtomically(tx");
  });

  it("persists NeedsInput answer lineage and queues a new feature run through CAS", () => {
    const answer = bodyAfter("export async function answerReviewProposal");

    expect(answer).toContain('current.status !== "NeedsInput"');
    expect(answer).toContain("answerLineage: [...lineage(current.partialOutput)");
    expect(answer).toContain('status: "Generating"');
    expect(answer).toContain('linkQueuedReviewRun(proposal, input.command.operationId, ["NeedsInput"])');
  });

  it("retries CannotComplete reviews by linking a new run through the proposal CAS", () => {
    const retry = bodyAfter("export async function retryReviewProposal");

    expect(retry).toContain('"CannotComplete", "Failed"');
    expect(retry).toContain('linkQueuedReviewRun(proposal, input.command.operationId, ["CannotComplete", "Failed"])');
    expect(retry).toContain('status: "Generating"');
  });

  it("reconciles terminal runtime failures into a durable Failed proposal", () => {
    const execute = bodyAfter("async function executeReview");

    expect(execute).toContain('run.status === "failed" || run.status === "cancelled"');
    expect(execute).toContain("await failGeneratingReview(proposal.id, proposal.aiFeatureRunId, run?.error?.code)");
    expect(execute).toContain("void executeReview(proposal.id).catch");
    expect(source).toContain('code === "provider_start_outcome_unknown"');
    expect(source).toContain("Chrona did not replay it");
  });

  it("marks stale items without applying mutations and guards apply with a proposal CAS", () => {
    const apply = bodyAfter("export async function applyGoalReviewProposal");
    const stale = apply.slice(0, apply.indexOf('if (action === "reject" || action === "ignore")'));

    expect(apply).toContain("return db.$transaction(async (tx) =>");
    expect(apply).toContain("proposal.stateVersion !== input.command.expectedVersion");
    expect(apply).toContain("expectedDependencyHashes[item.itemId] !== item.dependencyHash");
    expect(stale).toContain('decision: "Stale"');
    expect(stale).not.toContain("tx.goal.update");
    expect(stale).not.toContain("tx.task.create");
  });

  it("does not mutate Goal state or create Tasks before an explicit apply command", () => {
    const generation = source.slice(source.indexOf("export async function generateGoalReview"), source.indexOf("export async function applyGoalReviewProposal"));

    expect(generation).toContain("db.goalReviewProposal.create");
    expect(generation).not.toContain("tx.goal.update(");
    expect(generation).not.toContain("tx.task.create(");
  });
});
