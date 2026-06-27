import type { UiDocument } from "../document/document";

/**
 * Typed fallback result item shape used by deterministic empty/error/result
 * builders. Kept local so `ui-protocol` stays React-free and import-cycle-free.
 */
export type ResultOutputItemInput =
  | { kind: "markdown"; content: string; title?: string }
  | { kind: "json"; value: unknown; title?: string }
  | { kind: "file"; path: string; title?: string; language?: string; description?: string }
  | { kind: "link"; href: string; title: string; description?: string };

export interface BuildResultSpecOptions {
  /** Shown as a plain `Text` element when outputs is empty and no errorMessage is set. */
  emptyMessage?: string;
  /** Shown as a danger `Alert` element when outputs is empty. Takes precedence over emptyMessage. */
  errorMessage?: string;
}

/**
 * Deterministically build a result {@link UiDocument} from typed items. Used for
 * empty/error fallback tabs and non-generated result summaries. Pure and cheap.
 *
 * Mapping:
 * - `"markdown"` → `Markdown` (content + optional title)
 * - `"json"` → `JsonView` (value + optional title)
 * - `"file"` → `FileRef` (path + language + description)
 * - `"link"` → `Link` (href + label=title)
 *
 * Empty outputs with `options.errorMessage` → error `Alert`.
 * Empty outputs with `options.emptyMessage` → `Text` placeholder.
 * Empty outputs with neither → minimal `Stack` with no children.
 */
export function buildResultSpec(outputs: ResultOutputItemInput[], options?: BuildResultSpecOptions): UiDocument {
  const elements: UiDocument["elements"] = {};
  const rootChildren: string[] = [];

  elements.root = { type: "Stack", props: { gap: "md" }, children: rootChildren };

  if (outputs.length === 0) {
    if (options?.errorMessage) {
      elements["empty-state"] = {
        type: "Alert",
        props: { title: options.errorMessage, type: "error" },
      };
      rootChildren.push("empty-state");
    } else if (options?.emptyMessage) {
      elements["empty-state"] = {
        type: "Text",
        props: { text: options.emptyMessage },
      };
      rootChildren.push("empty-state");
    }
    return { root: "root", elements };
  }

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    const key = `out:${i}:${output.kind}`;

    switch (output.kind) {
      case "markdown":
        elements[key] = {
          type: "Markdown",
          props: {
            content: output.content,
            ...(output.title ? { title: output.title } : {}),
          },
        };
        break;

      case "json":
        elements[key] = {
          type: "JsonView",
          props: {
            value: output.value,
            ...(output.title ? { title: output.title } : {}),
          },
        };
        break;

      case "file":
        elements[key] = {
          type: "FileRef",
          props: {
            path: output.path,
            ...(output.title ? { title: output.title } : {}),
            ...(output.language ? { language: output.language } : {}),
            ...(output.description ? { description: output.description } : {}),
          },
        };
        break;

      case "link":
        elements[key] = {
          type: "Link",
          props: {
            href: output.href,
            label: output.title,
          },
        };
        break;
    }

    rootChildren.push(key);
  }

  return { root: "root", elements };
}
