import { NextResponse } from "next/server";
import {
  chatCompletionJSON,
  isLLMAvailable,
  taskAutoCompleteSystemPrompt,
} from "@/modules/ai/llm-service";

// ---------- Types ----------

interface AutoCompleteSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
}

interface AutoCompleteResponse {
  suggestions: AutoCompleteSuggestion[];
}

// ---------- Keyword-based fallback ----------

interface KeywordRule {
  keywords: string[];
  suggestions: AutoCompleteSuggestion[];
}

const keywordRules: KeywordRule[] = [
  {
    keywords: ["meeting", "meet", "call", "sync", "standup", "stand-up"],
    suggestions: [
      {
        title: "Team sync meeting",
        description: "Regular team synchronization to discuss progress, blockers, and next steps.",
        priority: "Medium",
        estimatedMinutes: 30,
        tags: ["meeting", "team"],
      },
      {
        title: "1:1 meeting",
        description: "One-on-one check-in to discuss goals, feedback, and development.",
        priority: "Medium",
        estimatedMinutes: 30,
        tags: ["meeting", "1:1"],
      },
    ],
  },
  {
    keywords: ["review", "pr", "code review", "feedback"],
    suggestions: [
      {
        title: "Code review",
        description: "Review pull request changes, check for bugs, and provide constructive feedback.",
        priority: "High",
        estimatedMinutes: 45,
        tags: ["review", "code"],
      },
      {
        title: "Review and provide feedback",
        description: "Thoroughly review the material and provide actionable feedback.",
        priority: "Medium",
        estimatedMinutes: 30,
        tags: ["review", "feedback"],
      },
    ],
  },
  {
    keywords: ["write", "draft", "document", "doc", "blog", "article"],
    suggestions: [
      {
        title: "Write documentation",
        description: "Draft clear and comprehensive documentation covering the key topics.",
        priority: "Medium",
        estimatedMinutes: 60,
        tags: ["writing", "documentation"],
      },
      {
        title: "Draft document outline",
        description: "Create a structured outline before writing the full document.",
        priority: "Low",
        estimatedMinutes: 30,
        tags: ["writing", "planning"],
      },
    ],
  },
  {
    keywords: ["fix", "bug", "debug", "issue", "error", "broken"],
    suggestions: [
      {
        title: "Fix bug",
        description: "Investigate the root cause, implement a fix, and verify the solution with tests.",
        priority: "High",
        estimatedMinutes: 60,
        tags: ["bug", "fix"],
      },
      {
        title: "Debug and investigate issue",
        description: "Reproduce the issue, trace through the code, and identify the root cause.",
        priority: "High",
        estimatedMinutes: 45,
        tags: ["debug", "investigation"],
      },
    ],
  },
  {
    keywords: ["test", "testing", "qa", "quality"],
    suggestions: [
      {
        title: "Write tests",
        description: "Write unit and integration tests to improve code coverage and reliability.",
        priority: "Medium",
        estimatedMinutes: 60,
        tags: ["testing", "quality"],
      },
      {
        title: "QA testing session",
        description: "Perform manual QA testing to verify functionality and catch edge cases.",
        priority: "Medium",
        estimatedMinutes: 45,
        tags: ["testing", "qa"],
      },
    ],
  },
  {
    keywords: ["deploy", "release", "ship", "publish", "launch"],
    suggestions: [
      {
        title: "Deploy to production",
        description: "Prepare and execute deployment: run final checks, deploy, and verify in production.",
        priority: "Urgent",
        estimatedMinutes: 30,
        tags: ["deployment", "release"],
      },
      {
        title: "Prepare release",
        description: "Update changelog, bump version, and prepare release notes.",
        priority: "High",
        estimatedMinutes: 45,
        tags: ["release", "planning"],
      },
    ],
  },
  {
    keywords: ["design", "ui", "ux", "mockup", "wireframe", "prototype"],
    suggestions: [
      {
        title: "Design UI mockup",
        description: "Create visual mockups or wireframes for the feature or page.",
        priority: "Medium",
        estimatedMinutes: 90,
        tags: ["design", "ui"],
      },
      {
        title: "UX review and improvements",
        description: "Evaluate current user experience and propose improvements.",
        priority: "Medium",
        estimatedMinutes: 60,
        tags: ["design", "ux"],
      },
    ],
  },
  {
    keywords: ["research", "explore", "investigate", "learn", "study"],
    suggestions: [
      {
        title: "Research and exploration",
        description: "Research the topic, gather information, and summarize findings.",
        priority: "Low",
        estimatedMinutes: 60,
        tags: ["research", "learning"],
      },
      {
        title: "Technical spike / investigation",
        description: "Time-boxed investigation into a technical approach or solution.",
        priority: "Medium",
        estimatedMinutes: 90,
        tags: ["research", "spike"],
      },
    ],
  },
  {
    keywords: ["plan", "planning", "roadmap", "strategy", "brainstorm"],
    suggestions: [
      {
        title: "Planning session",
        description: "Plan and outline the approach, milestones, and deliverables.",
        priority: "Medium",
        estimatedMinutes: 45,
        tags: ["planning", "strategy"],
      },
      {
        title: "Brainstorm ideas",
        description: "Collaborative brainstorming session to generate and evaluate ideas.",
        priority: "Low",
        estimatedMinutes: 30,
        tags: ["planning", "brainstorm"],
      },
    ],
  },
  {
    keywords: ["email", "respond", "reply", "message", "follow up", "followup"],
    suggestions: [
      {
        title: "Respond to emails",
        description: "Review and respond to pending emails and messages.",
        priority: "Medium",
        estimatedMinutes: 20,
        tags: ["communication", "email"],
      },
      {
        title: "Follow up on pending items",
        description: "Send follow-up messages on outstanding items and track responses.",
        priority: "Medium",
        estimatedMinutes: 15,
        tags: ["communication", "follow-up"],
      },
    ],
  },
];

/**
 * Generate fallback suggestions based on keyword matching in the title.
 * Returns 2-3 suggestions based on best keyword match, or generic defaults.
 */
function generateFallbackSuggestions(title: string): AutoCompleteSuggestion[] {
  const lowerTitle = title.toLowerCase();

  // Find the best matching rule
  let bestMatch: KeywordRule | null = null;
  let bestScore = 0;

  for (const rule of keywordRules) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (lowerTitle.includes(keyword)) {
        // Longer keyword matches are more specific, score higher
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  if (bestMatch) {
    // Customize matched suggestions with the user's title prefix
    return bestMatch.suggestions.map((s) => ({
      ...s,
      // If the user's title is more specific, incorporate it
      title: title.length > 3 ? `${title} — ${s.title}` : s.title,
    }));
  }

  // Generic fallback when no keywords match
  return [
    {
      title: title || "New task",
      description: "Complete this task as planned.",
      priority: "Medium",
      estimatedMinutes: 30,
      tags: ["general"],
    },
    {
      title: `${title || "Task"} — follow up`,
      description: "Follow up on this item and ensure completion.",
      priority: "Low",
      estimatedMinutes: 15,
      tags: ["follow-up"],
    },
    {
      title: `${title || "Task"} — review and finalize`,
      description: "Review the work done and finalize the deliverables.",
      priority: "Medium",
      estimatedMinutes: 20,
      tags: ["review"],
    },
  ];
}

// ---------- Route handler ----------

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, workspaceId } = body as {
      title?: string;
      workspaceId?: string;
    };

    if (!title || title.trim().length === 0) {
      return NextResponse.json(
        { error: "title is required and must be non-empty" },
        { status: 400 },
      );
    }

    const trimmedTitle = title.trim();

    // Try LLM-powered suggestions first
    if (isLLMAvailable()) {
      try {
        const userMessage = workspaceId
          ? `Suggest task completions for: "${trimmedTitle}" (workspace: ${workspaceId}). Provide 2-3 suggestions.`
          : `Suggest task completions for: "${trimmedTitle}". Provide 2-3 suggestions.`;

        const llmResult = await chatCompletionJSON<AutoCompleteResponse>({
          messages: [
            {
              role: "system",
              content: taskAutoCompleteSystemPrompt(),
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          temperature: 0.7,
          maxTokens: 1024,
        });

        if (llmResult?.suggestions && llmResult.suggestions.length > 0) {
          // Normalize the LLM response to match expected shape (strip reasoning if present)
          const suggestions: AutoCompleteSuggestion[] =
            llmResult.suggestions.map((s) => ({
              title: s.title,
              description: s.description,
              priority: s.priority,
              estimatedMinutes: s.estimatedMinutes,
              tags: s.tags ?? [],
            }));

          return NextResponse.json({ suggestions });
        }
      } catch (llmError) {
        // LLM call failed; fall through to rule-based fallback
        console.warn("LLM auto-complete failed, using fallback:", llmError);
      }
    }

    // Fallback: rule-based keyword suggestions
    const suggestions = generateFallbackSuggestions(trimmedTitle);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error in auto-complete:", error);
    return NextResponse.json(
      { error: "Failed to generate auto-complete suggestions" },
      { status: 500 },
    );
  }
}
