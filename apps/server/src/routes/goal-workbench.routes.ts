import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  archiveGoalAssetBodySchema,
  createAssetModificationTaskBodySchema,
  createGoalAssetJobBodySchema,
  createGoalFormSubmissionBodySchema,
  goalAssetKindSchema,
  resolveGoalInboxCandidateBodySchema,
  restoreGoalAssetVersionBodySchema,
  saveGoalAssetDraftBodySchema,
  submitGoalAssetDraftBodySchema,
} from "@chrona/contracts/api";
import type { ChronaEngine } from "@chrona/engine";
import { error, internalServerError, json, toHttpError } from "../lib/http";

const workspaceQuery = z.object({ workspaceId: z.string().trim().min(1) });
const goalParam = z.object({ goalId: z.string().trim().min(1) });
const assetParam = goalParam.extend({ assetId: z.string().trim().min(1) });
const versionParam = assetParam.extend({ versionId: z.string().trim().min(1) });
const assetDownloadQuery = z.object({ versionId: z.string().trim().min(1), mode: z.enum(["source", "export"]).default("source") });
const candidateParam = goalParam.extend({ candidateId: z.string().trim().min(1) });
const listAssetsQuery = workspaceQuery.extend({
  query: z.string().optional(),
  kind: goalAssetKindSchema.optional(),
  sourceTaskId: z.string().optional(),
  state: z.enum(["all", "draft", "running", "failed", "archived"]).default("all"),
  sort: z.enum(["updated_desc", "updated_asc", "name_asc"]).default("updated_desc"),
});
const renameBody = z.object({ label: z.string().trim().min(1).max(200) });
const extractBody = z.object({ taskId: z.string().trim().min(1), runId: z.string().trim().min(1) });

function fail(c: Parameters<typeof error>[0], route: string, cause: unknown) {
  const mapped = toHttpError(cause);
  if (mapped) return error(c, mapped.message, mapped.status);
  return internalServerError(c, route, cause, "Goal Workbench operation failed");
}

export function createGoalWorkbenchRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/goals/:goalId/assets", zValidator("param", goalParam), zValidator("query", listAssetsQuery), async (c) => {
      try { return json(c, await engine.goals.workbench.listAssets({ goalId: c.req.valid("param").goalId, ...c.req.valid("query") })); }
      catch (cause) { return fail(c, "GET /api/goals/:goalId/assets", cause); }
    })
    .get("/goals/:goalId/assets/:assetId", zValidator("param", assetParam), async (c) => {
      try { return json(c, await engine.goals.workbench.getAsset(c.req.valid("param"))); }
      catch (cause) { return fail(c, "GET /api/goals/:goalId/assets/:assetId", cause); }
    })
    .get("/goals/:goalId/assets/:assetId/download", zValidator("param", assetParam), zValidator("query", assetDownloadQuery), async (c) => {
      try {
        const { body, filename, mimeType } = await engine.goals.workbench.openAssetFile({ ...c.req.valid("param"), ...c.req.valid("query") });
        return new Response(body, { headers: { "content-type": mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
      } catch (cause) { return fail(c, "GET /api/goals/:goalId/assets/:assetId/download", cause); }
    })
    .patch("/goals/:goalId/assets/:assetId", zValidator("param", assetParam), zValidator("json", renameBody), async (c) => {
      try { return json(c, await engine.goals.workbench.renameAsset({ ...c.req.valid("param"), ...c.req.valid("json") })); }
      catch (cause) { return fail(c, "PATCH /api/goals/:goalId/assets/:assetId", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/drafts", zValidator("param", assetParam), zValidator("json", saveGoalAssetDraftBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.saveDraft({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/drafts", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/drafts/submit", zValidator("param", assetParam), zValidator("json", submitGoalAssetDraftBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.submitDraft({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/drafts/submit", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/versions/:versionId/restore", zValidator("param", versionParam), zValidator("json", restoreGoalAssetVersionBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.restoreVersion({ ...c.req.valid("param"), ...c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/versions/:versionId/restore", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/archive", zValidator("param", assetParam), zValidator("json", archiveGoalAssetBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.archiveAsset({ ...c.req.valid("param"), ...c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/archive", cause); }
    })
    .get("/goals/:goalId/inbox", zValidator("param", goalParam), zValidator("query", workspaceQuery), async (c) => {
      try { return json(c, await engine.goals.workbench.listInbox(c.req.valid("param"))); }
      catch (cause) { return fail(c, "GET /api/goals/:goalId/inbox", cause); }
    })
    .post("/goals/:goalId/inbox/extract", zValidator("param", goalParam), zValidator("json", extractBody), async (c) => {
      try { return json(c, await engine.goals.workbench.extractCandidates({ ...c.req.valid("param"), ...c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/inbox/extract", cause); }
    })
    .post("/goals/:goalId/inbox/:candidateId/resolve", zValidator("param", candidateParam), zValidator("json", resolveGoalInboxCandidateBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.resolveCandidate({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/inbox/:candidateId/resolve", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/submissions", zValidator("param", assetParam), zValidator("json", createGoalFormSubmissionBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.createSubmission({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/submissions", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/jobs", zValidator("param", assetParam), zValidator("json", createGoalAssetJobBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.createJob({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/jobs", cause); }
    })
    .post("/goals/:goalId/assets/:assetId/ai-modification-task", zValidator("param", assetParam), zValidator("json", createAssetModificationTaskBodySchema), async (c) => {
      try { return json(c, await engine.goals.workbench.createModificationTask({ ...c.req.valid("param"), command: c.req.valid("json") })); }
      catch (cause) { return fail(c, "POST /api/goals/:goalId/assets/:assetId/ai-modification-task", cause); }
    });
}
