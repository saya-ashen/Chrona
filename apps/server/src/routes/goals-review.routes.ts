/* eslint-disable max-lines-per-function, @typescript-eslint/no-unnecessary-condition -- Route orchestration keeps validated proposal authority in one auditable flow. */
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  answerGoalReviewProposalBodySchema,
  applyGoalReviewProposalBodySchema,
  generateGoalReviewBodySchema,
  goalArtifactParamSchema,
  goalIdParamSchema,
  goalReviewProgressEventSchema,
  goalReviewProposalParamSchema,
  promoteTaskToGoalBodySchema,
  promoteTaskToGoalParamSchema,
  rejectGoalReviewProposalBodySchema,
  retryGoalReviewProposalBodySchema,
  type GoalReviewProgressEvent,
} from "@chrona/contracts/api";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { error, json } from "../lib/http";
import { startSseHeartbeat } from "../lib/sse-heartbeat";
import { routeFailure } from "./goals-route-support";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function publicReviewProgress(event: GoalReviewProgressEvent): GoalReviewProgressEvent {
  return goalReviewProgressEventSchema.parse({
    proposalId: event.proposalId,
    status: event.status,
    version: event.version,
    ...(event.message ? { message: event.message } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  });
}

function writeReviewProgress(stream: SseStream, event: GoalReviewProgressEvent) {
  return stream.writeSSE({ event: "progress", data: JSON.stringify(publicReviewProgress(event)) });
}

function reviewProgressIsTerminal(status: GoalReviewProgressEvent["status"]) {
  return status !== "Generating";
}

export function registerGoalReviewRoutes(app: Hono, engine: ChronaEngine) {
  app
    .post(
      "/goals/:goalId/review-proposals/generate",
      zValidator("param", goalIdParamSchema),
      zValidator("json", generateGoalReviewBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.generateReview({
            goalId: c.req.valid("param").goalId,
            command: c.req.valid("json"),
          }), 202);
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/review-proposals/generate", cause, "Failed to generate Goal review");
        }
      },
    )
    .post(
      "/goals/:goalId/review-proposals/:proposalId/answers",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", answerGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.answerReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }), 202);
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/review-proposals/:proposalId/answers", cause, "Failed to answer Goal review questions");
        }
      },
    )
    .post(
      "/goals/:goalId/review-proposals/:proposalId/retry",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", retryGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.retryReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }), 202);
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/review-proposals/:proposalId/retry", cause, "Failed to retry Goal review");
        }
      },
    )
    .get(
      "/goals/:goalId/review-proposals/:proposalId/progress",
      zValidator("param", goalReviewProposalParamSchema),
      async (c) => {
        const params = c.req.valid("param");
        const bufferedEvents: GoalReviewProgressEvent[] = [];
        let enqueueEvent: ((event: GoalReviewProgressEvent) => void) | null = null;
        try {
          const subscription = await engine.goals.subscribeReviewProgress({
            ...params,
            onEvent(event) {
              if (enqueueEvent) enqueueEvent(event);
              else bufferedEvents.push(event);
            },
          });
          if (!subscription) return error(c, "Goal review proposal not found", 404);
          return streamSSE(c, async (stream) => {
            const stopHeartbeat = startSseHeartbeat(stream);
            let resolveClosed: (() => void) | null = null;
            const closed = new Promise<void>((resolve) => {
              resolveClosed = resolve;
            });
            let writeQueue = Promise.resolve();
            let terminalSeen = false;
            const queue = (event: GoalReviewProgressEvent) => {
              writeQueue = writeQueue.then(() => writeReviewProgress(stream, event)).then(() => undefined);
              if (reviewProgressIsTerminal(event.status)) {
                terminalSeen = true;
                void writeQueue.finally(() => resolveClosed?.());
              }
            };
            enqueueEvent = queue;
            for (const event of bufferedEvents) queue(event);
            bufferedEvents.length = 0;
            stream.onAbort(() => {
              subscription.unsubscribe();
              resolveClosed?.();
            });
            try {
              if (terminalSeen) await writeQueue;
              else await closed;
            } finally {
              subscription.unsubscribe();
              stopHeartbeat();
              await writeQueue;
            }
          });
        } catch (cause) {
          return routeFailure(c, "GET /api/goals/:goalId/review-proposals/:proposalId/progress", cause, "Failed to subscribe to Goal review progress");
        }
      },
    )
    .post(
      "/goals/:goalId/review-proposals/:proposalId/apply",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", applyGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.applyReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/review-proposals/:proposalId/apply", cause, "Failed to apply Goal review proposal");
        }
      },
    )
    .post(
      "/goals/:goalId/review-proposals/:proposalId/reject",
      zValidator("param", goalReviewProposalParamSchema),
      zValidator("json", rejectGoalReviewProposalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.rejectReviewProposal({
            ...c.req.valid("param"),
            command: c.req.valid("json"),
          }));
        } catch (cause) {
          return routeFailure(c, "POST /api/goals/:goalId/review-proposals/:proposalId/reject", cause, "Failed to reject Goal review proposal");
        }
      },
    )
    .get(
      "/goals/:goalId/artifacts/:artifactId",
      zValidator("param", goalArtifactParamSchema),
      async (c) => {
        try {
          return json(c, await engine.goals.getArtifact(c.req.valid("param")));
        } catch (cause) {
          return routeFailure(c, "GET /api/goals/:goalId/artifacts/:artifactId", cause, "Failed to get Goal artifact");
        }
      },
    )
    .post(
      "/tasks/:taskId/actions/promote-to-goal",
      zValidator("param", promoteTaskToGoalParamSchema),
      zValidator("json", promoteTaskToGoalBodySchema),
      async (c) => {
        try {
          return json(c, await engine.goals.promoteTask({
            taskId: c.req.valid("param").taskId,
            command: c.req.valid("json"),
          }), 201);
        } catch (cause) {
          return routeFailure(c, "POST /api/tasks/:taskId/actions/promote-to-goal", cause, "Failed to promote task to Goal");
        }
      },
    );
}
