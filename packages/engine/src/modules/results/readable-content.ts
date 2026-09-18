import { workResultContentSchema, type WorkResultContent } from "@chrona/contracts/results";
import { workPageSchema } from "@chrona/ui-protocol/work-pages";

/** A newer/invalid presentation must not hide the durable semantic result.
 * This is a read fallback only: publication and acceptance still validate the full content. */
export function readableResultContent(raw: unknown, canReadPage: boolean): { content: WorkResultContent; pageUnavailable: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid result content");
  const { page, ...semantic } = raw as Record<string, unknown>;
  const content = workResultContentSchema.parse(semantic);
  if (!canReadPage || page === undefined) return { content, pageUnavailable: false };
  const parsed = workPageSchema.safeParse(page);
  return parsed.success ? { content: { ...content, page: parsed.data }, pageUnavailable: false } : { content, pageUnavailable: true };
}
