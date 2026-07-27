import type {
  DeliverableKind,
  DeliverablePresentation,
  NodeDeliverable,
  NodeDeliverableDeclaration,
  ResultContribution,
  ResultEvidence,
} from "./node-result";

const deliverableKinds: DeliverableKind[] = [
  "document",
  "table",
  "dataset",
  "image",
  "archive",
  "code",
  "other",
];
const presentations: DeliverablePresentation["primary"][] = [
  "table",
  "file",
  "document",
  "image",
];
const placements: NodeDeliverable["placement"][] = [
  "primary",
  "supporting",
  "evidence",
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableKey(value: unknown, field: string): string {
  const key = requiredString(value, field);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(key)) {
    throw new Error(`${field} must be a stable key`);
  }
  return key;
}

export function parseNodeDeliverableDeclarations(
  value: unknown,
): NodeDeliverableDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("deliverables must be an array");
  const keys = new Set<string>();
  return value.map((candidate, index) => {
    const item = record(candidate);
    if (!item) throw new Error(`deliverables[${index}] must be an object`);
    const deliverableKey = stableKey(
      item.deliverableKey,
      `deliverables[${index}].deliverableKey`,
    );
    if (keys.has(deliverableKey)) {
      throw new Error(`Duplicate deliverableKey '${deliverableKey}'`);
    }
    keys.add(deliverableKey);
    const kind = requiredString(item.kind, `deliverables[${index}].kind`);
    if (!deliverableKinds.includes(kind as DeliverableKind)) {
      throw new Error(`deliverables[${index}].kind is invalid`);
    }
    const source = record(item.source);
    if (!source) throw new Error(`deliverables[${index}].source is required`);
    const sourceType = requiredString(
      source.type,
      `deliverables[${index}].source.type`,
    );
    const parsedSource: NodeDeliverableDeclaration["source"] | null =
      sourceType === "generated_file"
        ? {
            type: "generated_file",
            uri: requiredString(
              source.uri,
              `deliverables[${index}].source.uri`,
            ) as `generated://${string}`,
          }
        : sourceType === "existing_artifact"
          ? {
              type: "existing_artifact",
              artifactRef: requiredString(
                source.artifactRef,
                `deliverables[${index}].source.artifactRef`,
              ) as `AF${string}`,
            }
          : null;
    if (!parsedSource) {
      throw new Error(`deliverables[${index}].source.type is invalid`);
    }
    if (
      parsedSource.type === "generated_file" &&
      !parsedSource.uri.startsWith("generated://")
    ) {
      throw new Error(`deliverables[${index}].source.uri must use generated://`);
    }
    if (
      parsedSource.type === "existing_artifact" &&
      !/^AF[0-9A-F]{12}$/.test(parsedSource.artifactRef)
    ) {
      throw new Error(
        `deliverables[${index}].source.artifactRef must be an opaque AF reference`,
      );
    }
    const rawPresentation = record(item.presentation);
    const primary = rawPresentation?.primary === undefined
      ? (kind === "table" || kind === "dataset" ? "table" : "file")
      : requiredString(
          rawPresentation.primary,
          `deliverables[${index}].presentation.primary`,
        );
    if (!presentations.includes(primary as DeliverablePresentation["primary"])) {
      throw new Error(`deliverables[${index}].presentation.primary is invalid`);
    }
    const placement = item.placement === undefined
      ? "primary"
      : requiredString(item.placement, `deliverables[${index}].placement`);
    if (!placements.includes(placement as NodeDeliverable["placement"])) {
      throw new Error(`deliverables[${index}].placement is invalid`);
    }
    return {
      deliverableKey,
      title: requiredString(item.title, `deliverables[${index}].title`),
      kind: kind as DeliverableKind,
      source: parsedSource as NodeDeliverableDeclaration["source"],
      ...(optionalString(item.summary)
        ? { summary: optionalString(item.summary) }
        : {}),
      presentation: {
        primary: primary as DeliverablePresentation["primary"],
        allowDownload: rawPresentation?.allowDownload === undefined
          ? true
          : rawPresentation.allowDownload === true,
      },
      placement: placement as NodeDeliverable["placement"],
    };
  });
}

function parseContributions(
  value: unknown,
  field: string,
): ResultContribution[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((candidate, index) => {
    const item = record(candidate);
    if (!item) throw new Error(`${field}[${index}] must be an object`);
    const importance = item.importance === undefined
      ? undefined
      : requiredString(item.importance, `${field}[${index}].importance`);
    if (
      importance !== undefined &&
      importance !== "primary" &&
      importance !== "supporting"
    ) {
      throw new Error(`${field}[${index}].importance is invalid`);
    }
    return {
      key: stableKey(item.key, `${field}[${index}].key`),
      content: requiredString(item.content, `${field}[${index}].content`),
      ...(optionalString(item.title) ? { title: optionalString(item.title) } : {}),
      ...(importance ? { importance } : {}),
    };
  });
}

function parseEvidence(value: unknown): ResultEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("resultEvidence must be an array");
  return value.map((candidate, index) => {
    const item = record(candidate);
    if (!item) throw new Error(`resultEvidence[${index}] must be an object`);
    const artifactRef = optionalString(item.artifactRef);
    if (artifactRef && !/^AF[0-9A-F]{12}$/.test(artifactRef)) {
      throw new Error(
        `resultEvidence[${index}].artifactRef must be an opaque AF reference`,
      );
    }
    return {
      key: stableKey(item.key, `resultEvidence[${index}].key`),
      summary: requiredString(
        item.summary,
        `resultEvidence[${index}].summary`,
      ),
      sourceNodeRef: "",
      ...(artifactRef ? { artifactRef } : {}),
    } as ResultEvidence;
  });
}

export type ParsedNodeResultContent = {
  deliverables: NodeDeliverableDeclaration[];
  findings: ResultContribution[];
  decisions: ResultContribution[];
  caveats: ResultContribution[];
  nextActions: ResultContribution[];
  resultEvidence: ResultEvidence[];
};

export function parseNodeResultContent(
  value: Record<string, unknown>,
): ParsedNodeResultContent {
  return {
    deliverables: parseNodeDeliverableDeclarations(value.deliverables),
    findings: parseContributions(value.findings, "findings"),
    decisions: parseContributions(value.decisions, "decisions"),
    caveats: parseContributions(value.caveats, "caveats"),
    nextActions: parseContributions(value.nextActions, "nextActions"),
    resultEvidence: parseEvidence(value.evidenceItems),
  };
}
