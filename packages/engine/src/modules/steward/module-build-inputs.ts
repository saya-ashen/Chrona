/** Private retained build/rescue inputs. These do not register public kernel tools. */
import { z } from "zod";
import { relativePathSchema, slug } from "@chrona/contracts/steward";

const id = z.string().trim().min(1).max(128);
const text = z.string().trim().min(1);

export const buildIntentSchema = z.object({ changes: z.array(text.max(500)).min(1).max(20), preserves: z.array(text.max(500)).max(20).default([]) }).strict()
  .describe("What this version changes and what it keeps (shown on the approval card)");

export const reviseBuildSchema = z.object({ session: id, requirements: text.max(4000),
    files: z.array(relativePathSchema).max(10).optional().describe("Additional required references from the calling Provider's cwd or content/chat/. Provider only; owner requests cannot supply filesystem paths.") }).strict()
    .describe("Stop the old module build run and queue a revision at the tail in the same conversation, preserving files and history. Providers may supplement references via files; missing files fail before stopping the old run. Existing approval decisions are unchanged. Returns runId and queuePosition; no automatic retry.");

export const buildRequestSchema = z.object({ name: slug.optional().describe("The one module to write or change (or use modules)"),
    modules: z.array(slug).min(1).max(4).optional().describe("v2-15: every module this one change touches (1-4), built together and activated together"),
    goal: text.max(4000), examples: z.array(text.max(1000)).max(10).default([]),
    files: z.array(relativePathSchema).max(10).default([]).describe("Reference files (e.g. screenshots the user sent): attachments under content/chat/ or files in your working directory"),
    intent: buildIntentSchema,
    cause: z.object({ moduleId: id, activationId: id, incidentId: id.optional(), topic: z.string().regex(/^[\w:.-]{1,80}$/).optional() }).strict()
      .refine(cause => (cause.incidentId === undefined) !== (cause.topic === undefined), "Give either incidentId or topic").optional()
      .describe("Only for an autonomous fix of a health fact (the ref from modules.health / the mind brief). While a build with the same cause is queued or running, that build is returned instead of a new one. Omit for anything the user asked for.") }).strict()
    .refine(input => (input.name === undefined) !== (input.modules === undefined), "Give either name or modules")
    .refine(input => !input.modules || new Set(input.modules).size === input.modules.length, "modules must not repeat")
    .describe("Queue a build conversation: a separate session writes, tests and submits the module(s), then reports back here. A change that spans several modules is one build with modules: [...], not several builds the user must activate in order. FIFO, one running and up to 10 waiting per workspace; waiting makes no model calls. Returns status (build_queued/build_running), sessionId, runId, queuePosition and aheadCount. Identical outstanding requests from this conversation reuse the build; an outstanding build with the same cause (any conversation) is returned with duplicate: true and charges no budget. Daily new-session allowance is charged at admission; runtime limits start at claim. No dependency ordering beyond FIFO and no automatic retry.");
