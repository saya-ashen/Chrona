import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  listTasksQuerySchema,
  createTaskBodySchema,
  refineRecurrenceAnchors,
  taskDetailParamSchema,
  taskNodeActivityParamSchema,
  updateTaskParamSchema,
  updateTaskBodySchema,
  deleteTaskParamSchema,
  deleteTaskQuerySchema,
  deleteTaskBodySchema,
  workspaceActivityPageQuerySchema,
  resultFileAccessApproveBodySchema,
  resultFileAccessParamSchema,
  resultFileAccessRequestBodySchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

async function taskContextResponse(
  c: Context,
  contextName: string,
  load: () => Promise<unknown>,
) {
  try {
    return json(c, await load());
  } catch (cause) {
    const httpError = toHttpError(cause);
    if (httpError) {
      return error(c, httpError.message, httpError.status);
    }
    return internalServerError(
      c,
      contextName,
      cause,
      "Failed to get task context",
    );
  }
}
export function createTasksRoutes(engine: ChronaEngine) {
  const supportedCreateTaskBodySchema = refineRecurrenceAnchors(createTaskBodySchema);

  return new Hono()
    .get("/tasks", zValidator("query", listTasksQuerySchema), async (c) => {
      try {
        const {
          workspaceId,
          status,
          filter,
          priority,
          search,
          sort,
          order,
          page,
          pageSize,
        } = c.req.valid("query");

        const result = await engine.tasks.list({
          workspaceId,
          status: status ?? undefined,
          filter,
          priority,
          search,
          sort,
          order,
          page,
          pageSize,
        });

        return json(c, result);
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(
          c,
          "GET /api/tasks",
          cause,
          "Failed to list tasks",
        );
      }
    })
    .post(
      "/tasks",
      zValidator("json", supportedCreateTaskBodySchema),
      async (c) => {
        try {
          const body = c.req.valid("json");

          const result = await engine.tasks.create({
            workspaceId: body.workspaceId,
            title: body.title,
            description: body.description,
            priority: body.priority,
            autoPlanGeneration: body.autoPlanGeneration,
            autoExecute: body.autoExecute,
            autoPlanGenerationTiming: body.autoPlanGenerationTiming,
            autoExecuteTiming: body.autoExecuteTiming,
            executionConfig: body.executionConfig,
            aiClientId: body.aiClientId,
            recurrenceRule: body.recurrenceRule,
            recurrenceAnchorStartAt: body.recurrenceAnchorStartAt,
            recurrenceAnchorEndAt: body.recurrenceAnchorEndAt,
          });

          return json(c, result, 201);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "POST /api/tasks",
            cause,
            "Failed to create task",
          );
        }
      },
    )
    .get(
      "/tasks/:taskId/activity",
      zValidator("param", taskDetailParamSchema),
      zValidator("query", workspaceActivityPageQuerySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const query = c.req.valid("query");
          return json(
            c,
            await engine.tasks.getActivityPage({
              taskId,
              scope: "task",
              cursor: query.cursor,
              limit: query.limit,
            }),
          );
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/activity",
            cause,
            "Failed to get task activity",
          );
        }
      },
    )
    .get(
      "/tasks/:taskId/nodes/:nodeId/activity",
      zValidator("param", taskNodeActivityParamSchema),
      zValidator("query", workspaceActivityPageQuerySchema),
      async (c) => {
        try {
          const { taskId, nodeId } = c.req.valid("param");
          const query = c.req.valid("query");
          return json(
            c,
            await engine.tasks.getActivityPage({
              taskId,
              scope: "node",
              nodeId,
              cursor: query.cursor,
              limit: query.limit,
            }),
          );
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/nodes/:nodeId/activity",
            cause,
            "Failed to get node activity",
          );
        }
      },
    )
    .get(
      "/tasks/:taskId/runtime-context",
      zValidator("param", taskDetailParamSchema),
      async (c) =>
        taskContextResponse(c, "GET /api/tasks/:taskId/runtime-context", () =>
          engine.tasks.getRuntimeContext({
            taskId: c.req.valid("param").taskId,
            workBlockId: c.req.query("workBlockId") ?? null,
          }),
        ),
    )
    .get(
      "/tasks/:taskId/review-context",
      zValidator("param", taskDetailParamSchema),
      async (c) =>
        taskContextResponse(c, "GET /api/tasks/:taskId/review-context", () =>
          engine.tasks.getReviewContext({
            taskId: c.req.valid("param").taskId,
            workBlockId: c.req.query("workBlockId") ?? null,
          }),
        ),
    )
    .get(
      "/tasks/:taskId/command-center",
      zValidator("param", taskDetailParamSchema),
      async (c) =>
        taskContextResponse(c, "GET /api/tasks/:taskId/command-center", () =>
          engine.tasks.getCommandCenter({
            taskId: c.req.valid("param").taskId,
            workBlockId: c.req.query("workBlockId") ?? null,
          }),
        ),
    )
    .get(
      "/tasks/:taskId/result-files/download",
      zValidator("param", resultFileAccessParamSchema),
      zValidator("query", resultFileAccessRequestBodySchema),
      async (c) => {
        try {
          const result = await engine.tasks.openResultFile({
            taskId: c.req.valid("param").taskId,
            requestedPath: c.req.valid("query").path,
          });
          return new Response(result.stream, {
            headers: {
              "Content-Type": result.contentType,
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/result-files/download",
            cause,
            "Failed to download task result file",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/result-files/access-requests",
      zValidator("param", resultFileAccessParamSchema),
      zValidator("json", resultFileAccessRequestBodySchema),
      async (c) =>
        taskContextResponse(
          c,
          "POST /api/tasks/:taskId/result-files/access-requests",
          () =>
            engine.tasks.requestResultFileAccess({
              taskId: c.req.valid("param").taskId,
              requestedPath: c.req.valid("json").path,
            }),
        ),
    )
    .post(
      "/tasks/:taskId/result-files/access-requests/approve",
      zValidator("param", resultFileAccessParamSchema),
      zValidator("json", resultFileAccessApproveBodySchema),
      async (c) =>
        taskContextResponse(
          c,
          "POST /api/tasks/:taskId/result-files/access-requests/approve",
          async () => {
            const grant = await engine.tasks.approveResultFileAccess({
              taskId: c.req.valid("param").taskId,
              requestId: c.req.valid("json").requestId,
            });
            return {
              ...grant,
              preview: await engine.tasks.previewResultFile({
                path: grant.requestedPath,
                canonicalPath: grant.canonicalPath,
              }),
            };
          },
        ),
    )
    .get(
      "/tasks/:taskId/workspace/header",
      zValidator("param", taskDetailParamSchema),
      async (c) =>
        taskContextResponse(c, "GET /api/tasks/:taskId/workspace/header", () =>
          engine.tasks.getHeaderSpec({
            taskId: c.req.valid("param").taskId,
            workBlockId: c.req.query("workBlockId") ?? null,
          }),
        ),
    )
    .get(
      "/tasks/:taskId",
      zValidator("param", taskDetailParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const workBlockId = c.req.query("workBlockId") ?? null;
          return json(
            c,
            await engine.tasks.getBootstrap({ taskId, workBlockId }),
          );
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "GET /api/tasks/:taskId",
            cause,
            "Failed to get task",
          );
        }
      },
    )
    .patch(
      "/tasks/:taskId",
      zValidator("param", updateTaskParamSchema),
      zValidator("json", updateTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const result = await engine.tasks.update({
            taskId,
            workspaceId: body.workspaceId,
            title: body.title,
            description: body.description,
            priority: body.priority,
            autoPlanGeneration: body.autoPlanGeneration,
            autoExecute: body.autoExecute,
            autoPlanGenerationTiming: body.autoPlanGenerationTiming,
            autoExecuteTiming: body.autoExecuteTiming,
            status: body.status,
            executionConfig: body.executionConfig,
            aiClientId: body.aiClientId,
            recurrenceRule: body.recurrenceRule,
            recurrenceAnchorStartAt: body.recurrenceAnchorStartAt,
            recurrenceAnchorEndAt: body.recurrenceAnchorEndAt,
          });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "PATCH /api/tasks/:taskId",
            cause,
            "Failed to update task",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/actions/rebuild-with-latest-goal-assets",
      zValidator("param", taskDetailParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.rebuildWithLatestGoalAssets({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/actions/rebuild-with-latest-goal-assets",
            cause,
            "Failed to rebuild task with latest Goal assets",
          );
        }
      },
    )
    .get(
      "/tasks/:taskId/delete-impact",
      zValidator("param", deleteTaskParamSchema),
      zValidator("query", deleteTaskQuerySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { workspaceId } = c.req.valid("query");
          return json(c, await engine.tasks.getDeleteImpact({ taskId, workspaceId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/delete-impact",
            cause,
            "Failed to inspect task deletion",
          );
        }
      },
    )
    .delete(
      "/tasks/:taskId",
      zValidator("param", deleteTaskParamSchema),
      zValidator("query", deleteTaskQuerySchema),
      zValidator("json", deleteTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { workspaceId } = c.req.valid("query");
          const { expectedTaskIds, expectedAssetIds } = c.req.valid("json");
          return json(c, await engine.tasks.delete({ taskId, workspaceId, expectedTaskIds, expectedAssetIds }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "DELETE /api/tasks/:taskId",
            cause,
            "Failed to delete task",
          );
        }
      },
    );
}
