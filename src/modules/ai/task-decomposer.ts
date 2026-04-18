import type {
  TaskDecompositionInput,
  SubtaskSuggestion,
  TaskDecompositionResult,
} from "./types";
import { aiChat } from "./ai-service";

// --- Conjunction / keyword patterns ---

/** English conjunctions and sequencing words that suggest multiple sub-tasks */
const EN_SPLIT_CONJUNCTIONS = [
  " and then ",
  " and ",
  " then ",
  " also ",
  " plus ",
  " as well as ",
  " followed by ",
  " after that ",
];

/** Chinese conjunctions / sequencing words */
const ZH_SPLIT_CONJUNCTIONS = [
  "然后",
  "以及",
  "并且",
  "接着",
  "之后",
  "同时",
  "还有",
  "以及",
  "和",
];

/** Japanese conjunctions */
const JA_SPLIT_CONJUNCTIONS = [
  "そして",
  "それから",
  "その後",
  "また",
  "および",
];

/**
 * Common multi-verb patterns in titles that imply decomposition.
 * Each entry is [regex, array-of-subtask-verb-prefixes].
 */
const VERB_PATTERNS: Array<{ pattern: RegExp; verbs: string[] }> = [
  {
    pattern: /\breview\s+and\s+update\b/i,
    verbs: ["Review", "Update"],
  },
  {
    pattern: /\bresearch,?\s+design,?\s+(?:and\s+)?implement\b/i,
    verbs: ["Research", "Design", "Implement"],
  },
  {
    pattern: /\bplan\s+and\s+execute\b/i,
    verbs: ["Plan", "Execute"],
  },
  {
    pattern: /\bdesign\s+and\s+implement\b/i,
    verbs: ["Design", "Implement"],
  },
  {
    pattern: /\btest\s+and\s+deploy\b/i,
    verbs: ["Test", "Deploy"],
  },
  {
    pattern: /\bbuild\s+and\s+test\b/i,
    verbs: ["Build", "Test"],
  },
  {
    pattern: /\bwrite\s+and\s+review\b/i,
    verbs: ["Write", "Review"],
  },
  {
    pattern: /\bcreate\s+and\s+publish\b/i,
    verbs: ["Create", "Publish"],
  },
];

// ─── Helpers ───────────────────────────────────────────

/**
 * Derive subtask priority from the parent task priority.
 * Subtasks generally inherit the parent priority, but the first subtask may
 * be slightly elevated if the parent is high-priority (we keep it simple here).
 */
function derivePriority(parentPriority?: string): string {
  if (!parentPriority) return "Medium";
  // Normalize common casing
  const p = parentPriority.charAt(0).toUpperCase() + parentPriority.slice(1).toLowerCase();
  if (["Low", "Medium", "High", "Urgent"].includes(p)) return p;
  return "Medium";
}

/**
 * Estimate minutes for a single subtask when we know the total and count.
 */
function distributeMinutes(total: number, count: number, index: number): number {
  if (count <= 0) return 30;
  const base = Math.floor(total / count);
  // Give the remainder to the last subtask
  if (index === count - 1) {
    return base + (total - base * count);
  }
  return base;
}

/**
 * Heuristic: estimate total minutes from the title length / complexity
 * when no estimate is provided.
 */
function heuristicTotalMinutes(subtaskCount: number): number {
  // Default: 30 minutes per subtask
  return subtaskCount * 30;
}

/**
 * Detect whether the description uses sequential language implying
 * subtasks depend on each other.
 */
function hasSequentialSignals(text: string): boolean {
  const signals = [
    /\bthen\b/i,
    /\bafter\b/i,
    /\bbefore\b/i,
    /\bnext\b/i,
    /\bfirst\b/i,
    /\bfinally\b/i,
    /然后/,
    /接着/,
    /之后/,
    /まず/,
    /次に/,
    /最後に/,
  ];
  return signals.some((re) => re.test(text));
}

// ─── Splitting strategies ──────────────────────────────

/**
 * Strategy 1: Split title by conjunctions.
 * Returns null if no split is found.
 */
function splitByConjunctions(title: string): string[] | null {
  // Check English conjunctions (longer patterns first to avoid partial matches)
  for (const conj of EN_SPLIT_CONJUNCTIONS) {
    if (title.toLowerCase().includes(conj.toLowerCase())) {
      const parts = title.split(new RegExp(escapeRegex(conj), "i"))
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= 2) return parts;
    }
  }

  // Check Chinese conjunctions
  for (const conj of ZH_SPLIT_CONJUNCTIONS) {
    if (title.includes(conj)) {
      const parts = title.split(conj).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts;
    }
  }

  // Check Japanese conjunctions
  for (const conj of JA_SPLIT_CONJUNCTIONS) {
    if (title.includes(conj)) {
      const parts = title.split(conj).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts;
    }
  }

  return null;
}

/**
 * Strategy 2: Match known verb patterns in the title.
 * Returns verb-based subtask titles, or null.
 */
function splitByVerbPatterns(title: string): string[] | null {
  for (const { pattern, verbs } of VERB_PATTERNS) {
    if (pattern.test(title)) {
      // Extract the object from the title (everything after the verb phrase)
      const cleaned = title.replace(pattern, "").trim();
      // Use cleaned as the object part, falling back to original title context
      const object = cleaned.replace(/^[:\-–—]\s*/, "").trim();
      return verbs.map((verb) =>
        object ? `${verb} ${object}` : verb,
      );
    }
  }
  return null;
}

/**
 * Strategy 3: Split by comma-separated items in the title (3+ items suggests a list).
 */
function splitByCommaList(title: string): string[] | null {
  // Match "Do X, Y, and Z" or "Do X, Y, Z"
  const commaItems = title.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (commaItems.length >= 3) {
    // Clean up trailing "and" in the last item
    const last = commaItems[commaItems.length - 1];
    if (last.toLowerCase().startsWith("and ")) {
      commaItems[commaItems.length - 1] = last.slice(4).trim();
    }
    return commaItems;
  }
  return null;
}

/**
 * Strategy 4: Extract items from the description.
 * Handles numbered lists (1. 2. 3.) and bullet points (- * •).
 */
function extractDescriptionItems(description: string): string[] {
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];

  for (const line of lines) {
    // Numbered list: "1. Something" or "1) Something"
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)/);
    if (numberedMatch) {
      items.push(numberedMatch[1].trim());
      continue;
    }

    // Bullet points: "- Something", "* Something", "• Something", "· Something"
    const bulletMatch = line.match(/^[-*•·]\s+(.+)/);
    if (bulletMatch) {
      items.push(bulletMatch[1].trim());
      continue;
    }

    // Checkbox style: "[ ] Something" or "[x] Something"
    const checkboxMatch = line.match(/^\[[ x]\]\s+(.+)/i);
    if (checkboxMatch) {
      items.push(checkboxMatch[1].trim());
      continue;
    }
  }

  return items;
}

/**
 * Strategy 5: Time-based splitting for long tasks.
 * If estimatedMinutes > 120, suggest splitting into chunks.
 */
function splitByDuration(title: string, estimatedMinutes: number): string[] | null {
  if (estimatedMinutes <= 120) return null;

  const chunkSize = 60; // 1-hour chunks
  const chunkCount = Math.ceil(estimatedMinutes / chunkSize);
  // Cap at reasonable number
  const cappedCount = Math.min(chunkCount, 8);

  const parts: string[] = [];
  for (let i = 0; i < cappedCount; i++) {
    parts.push(`${title} (part ${i + 1}/${cappedCount})`);
  }
  return parts;
}

// ─── Feasibility scoring ───────────────────────────────

/**
 * Calculate a feasibility score (0-100) based on:
 * - Number of subtasks (too few or too many lowers score)
 * - Clarity of the decomposition method used
 * - Presence of descriptions
 * - Time estimates being reasonable
 */
function calculateFeasibility(
  subtasks: SubtaskSuggestion[],
  method: "conjunction" | "verb_pattern" | "comma_list" | "description" | "duration" | "none",
): number {
  if (subtasks.length === 0) return 0;

  let score = 50; // base score

  // Method confidence
  const methodScores: Record<string, number> = {
    description: 25,
    verb_pattern: 20,
    conjunction: 15,
    comma_list: 12,
    duration: 10,
    none: 0,
  };
  score += methodScores[method] ?? 0;

  // Subtask count sweet spot (2-5 subtasks is ideal)
  if (subtasks.length >= 2 && subtasks.length <= 5) {
    score += 15;
  } else if (subtasks.length >= 6 && subtasks.length <= 8) {
    score += 5;
  } else if (subtasks.length > 8) {
    score -= 10;
  }

  // Descriptions present
  const withDescriptions = subtasks.filter((s) => s.description && s.description.length > 0).length;
  if (withDescriptions > 0) {
    score += Math.min(10, withDescriptions * 2);
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Warnings ──────────────────────────────────────────

/**
 * Generate warnings about the decomposition.
 */
function generateWarnings(
  input: TaskDecompositionInput,
  subtasks: SubtaskSuggestion[],
  totalMinutes: number,
): string[] {
  const warnings: string[] = [];

  // Check if total estimated time exceeds time until due date
  if (input.dueAt) {
    const dueDate = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt as string);
    if (!isNaN(dueDate.getTime())) {
      const now = new Date();
      const availableMinutes = (dueDate.getTime() - now.getTime()) / 60000;
      if (availableMinutes < totalMinutes) {
        warnings.push(
          `Total estimated time (${totalMinutes} min) exceeds available time before due date (${Math.max(0, Math.round(availableMinutes))} min remaining)`,
        );
      }
      if (availableMinutes <= 0) {
        warnings.push("Task is already past its due date");
      }
    }
  }

  // Too many subtasks
  if (subtasks.length > 8) {
    warnings.push(
      `Large number of subtasks (${subtasks.length}) — consider grouping related items`,
    );
  }

  // Very short subtasks
  const veryShort = subtasks.filter((s) => s.estimatedMinutes < 5);
  if (veryShort.length > 0) {
    warnings.push(
      `${veryShort.length} subtask(s) estimated under 5 minutes — consider merging them`,
    );
  }

  return warnings;
}

// ─── Utility ───────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Main function ─────────────────────────────────────

/**
 * Decompose a task into subtask suggestions using rule-based heuristics.
 *
 * The engine applies multiple strategies in priority order:
 * 1. Description list items (numbered lists, bullets, checkboxes)
 * 2. Known verb patterns ("review and update")
 * 3. Comma-separated list in title (3+ items)
 * 4. Title conjunction splitting ("X and Y", "X 和 Y")
 * 5. Duration-based splitting (for long tasks >120 min)
 *
 * Returns a result with subtask suggestions, estimated time, and feasibility score.
 */
export function decomposeTask(input: TaskDecompositionInput): TaskDecompositionResult {
  const { title, description, priority, estimatedMinutes } = input;
  const normalizedPriority = derivePriority(priority);
  const sequential = hasSequentialSignals(`${title} ${description ?? ""}`);

  let rawParts: string[] = [];
  let method: "conjunction" | "verb_pattern" | "comma_list" | "description" | "duration" | "none" = "none";

  // Strategy 1: Description-based extraction (highest confidence — explicit list)
  if (description) {
    const descItems = extractDescriptionItems(description);
    if (descItems.length >= 2) {
      rawParts = descItems;
      method = "description";
    }
  }

  // Strategy 2: Known verb patterns
  if (rawParts.length === 0) {
    const verbParts = splitByVerbPatterns(title);
    if (verbParts && verbParts.length >= 2) {
      rawParts = verbParts;
      method = "verb_pattern";
    }
  }

  // Strategy 3: Comma list in title (checked before simple conjunctions,
  // because "X, Y, and Z" should parse as 3 items, not split on "and")
  if (rawParts.length === 0) {
    const commaParts = splitByCommaList(title);
    if (commaParts && commaParts.length >= 3) {
      rawParts = commaParts;
      method = "comma_list";
    }
  }

  // Strategy 4: Title conjunction splitting
  if (rawParts.length === 0) {
    const conjParts = splitByConjunctions(title);
    if (conjParts && conjParts.length >= 2) {
      rawParts = conjParts;
      method = "conjunction";
    }
  }

  // Strategy 5: Duration-based splitting
  if (rawParts.length === 0 && estimatedMinutes && estimatedMinutes > 120) {
    const durationParts = splitByDuration(title, estimatedMinutes);
    if (durationParts && durationParts.length >= 2) {
      rawParts = durationParts;
      method = "duration";
    }
  }

  // If no strategy produced results, return empty
  if (rawParts.length === 0) {
    return {
      subtasks: [],
      totalEstimatedMinutes: estimatedMinutes ?? 0,
      feasibilityScore: 0,
      warnings: ["Could not identify a clear decomposition strategy for this task"],
    };
  }

  // Build subtask suggestions
  const totalMin = estimatedMinutes ?? heuristicTotalMinutes(rawParts.length);
  const subtasks: SubtaskSuggestion[] = rawParts.map((part, index) => ({
    title: capitalizeFirst(part),
    description: undefined,
    estimatedMinutes: distributeMinutes(totalMin, rawParts.length, index),
    priority: normalizedPriority,
    order: index + 1,
    dependsOnPrevious: sequential && index > 0,
  }));

  const totalEstimatedMinutes = subtasks.reduce((sum, s) => sum + s.estimatedMinutes, 0);
  const feasibilityScore = calculateFeasibility(subtasks, method);
  const warnings = generateWarnings(input, subtasks, totalEstimatedMinutes);

  return {
    subtasks,
    totalEstimatedMinutes,
    feasibilityScore,
    warnings,
  };
}

// ─── LLM-powered decomposition ─────────────────────────

/**
 * Decompose a task using LLM intelligence. Falls back to rule-based if LLM unavailable.
 * This is the preferred entry point for API routes.
 */
export async function decomposeTaskSmart(
  input: TaskDecompositionInput,
): Promise<TaskDecompositionResult> {
  // Try AI first
  try {
    const result = await decomposeTaskWithAI(input);
    if (result && result.subtasks.length > 0) {
      return result;
    }
  } catch (err) {
    console.warn("[task-decomposer] AI decomposition failed, falling back to rules:", err);
  }

  // Fall back to rule-based
  return decomposeTask(input);
}

/**
 * Decompose using AI. Returns null if AI is not available.
 */
async function decomposeTaskWithAI(
  input: TaskDecompositionInput,
): Promise<TaskDecompositionResult | null> {
  const userPrompt = buildDecompositionPrompt(input);

  const systemPrompt = `You are a task decomposition assistant that breaks tasks into actionable subtasks.
Return valid JSON only:
{"subtasks":[{"title":"...","description":"...","estimatedMinutes":N,"priority":"Low|Medium|High|Urgent","order":N,"dependsOnPrevious":true|false}],"totalEstimatedMinutes":N,"feasibilityScore":0.0-1.0,"warnings":["..."]}
Respond in the same language as the input.`;

  const chatResult = await aiChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 2000,
  });

  if (!chatResult?.parsed) return null;

  const result = chatResult.parsed as {
    subtasks: Array<{
      title: string;
      description?: string;
      estimatedMinutes: number;
      priority: string;
      order: number;
      dependsOnPrevious: boolean;
    }>;
    totalEstimatedMinutes: number;
    feasibilityScore: number;
    warnings: string[];
  };

  if (!Array.isArray(result.subtasks)) return null;

  return {
    subtasks: result.subtasks.map((s) => ({
      title: s.title,
      description: s.description,
      estimatedMinutes: s.estimatedMinutes,
      priority: s.priority,
      order: s.order,
      dependsOnPrevious: s.dependsOnPrevious,
    })),
    totalEstimatedMinutes: result.totalEstimatedMinutes,
    feasibilityScore: result.feasibilityScore,
    warnings: result.warnings ?? [],
  };
}

function buildDecompositionPrompt(input: TaskDecompositionInput): string {
  const parts = [`Task Title: ${input.title}`];
  if (input.description) parts.push(`Description: ${input.description}`);
  if (input.priority) parts.push(`Priority: ${input.priority}`);
  if (input.estimatedMinutes) parts.push(`Estimated Duration: ${input.estimatedMinutes} minutes`);
  if (input.dueAt) {
    const d = input.dueAt instanceof Date ? input.dueAt.toISOString() : String(input.dueAt);
    parts.push(`Due Date: ${d}`);
  }
  return parts.join("\n");
}

export type {
  TaskDecompositionInput,
  SubtaskSuggestion,
  TaskDecompositionResult,
};
