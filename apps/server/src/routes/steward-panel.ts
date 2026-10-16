import { z } from "zod";
import { panelSpecSchema, parsePanelBlocks } from "@chrona/domain/steward/markdown";

const pageSchema = z.object({ elements: z.record(z.string(), z.object({ type: z.string(), props: z.unknown() })) });

/** Only validated declarations authorize writes; unrelated malformed pages are ignored. */
export function declaredPanel(content: string, path: string, dataPath: string) {
  if (path.endsWith(".md")) return parsePanelBlocks(content).find(panel => panel.data === dataPath);
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return undefined; }
  const page = pageSchema.safeParse(raw);
  if (!page.success) return undefined;
  for (const element of Object.values(page.data.elements)) {
    if (element.type !== "Panel") continue;
    const panel = panelSpecSchema.safeParse(element.props);
    if (panel.success && panel.data.data === dataPath) return panel.data;
  }
  return undefined;
}
