import { describe, expect, it } from "bun:test";
import { extractAcceptedResultText } from "./accepted-result-context";

describe("extractAcceptedResultText", () => {
  it("extracts current ResultSummary text props", () => {
    const result = extractAcceptedResultText({
      root: "root",
      elements: {
        root: {
          type: "ResultSummary",
          props: {
            text: "Today has 13 trending projects.",
            copyText: "13 projects",
          },
        },
      },
    });

    expect(result).toContain("Today has 13 trending projects.");
    expect(result).toContain("13 projects");
  });

  it("extracts JSON-backed table rows from hydrated content", () => {
    const result = extractAcceptedResultText({
      root: "root",
      elements: {
        root: {
          type: "Table",
          props: {
            title: "GitHub Trending",
            columns: [
              { key: "repository", label: "Repository" },
              { key: "description", label: "Description" },
            ],
            contentPreview: JSON.stringify([
              {
                repository: "HKUDS/DeepTutor",
                description: "Lifelong Personalized Tutoring",
              },
            ]),
          },
        },
      },
    });

    expect(result).toContain("HKUDS/DeepTutor");
    expect(result).toContain("Lifelong Personalized Tutoring");
  });
  it("extracts finalized result components into reusable context", () => {
    const result = extractAcceptedResultText({
      root: "hero",
      elements: {
        hero: {
          type: "ResultHero",
          props: {
            title: "PhD channel guide ready",
            summary: "A reusable Chinese guide for finding matching positions.",
            readiness: "ready",
            readinessSummary: "Ready for ongoing searches.",
            metrics: [{ label: "Channels", value: "24" }],
          },
        },
        deliverable: {
          type: "ResultDeliverable",
          props: {
            title: "AI Agent × LLM × Bioinformatics PhD Guide",
            summary: "Primary Chinese deliverable.",
            role: "primary",
            kind: "document",
            formatLabel: "Chinese guide",
            path: "GF0364A5F97C1D",
          },
        },
        insight: {
          type: "ResultInsight",
          props: {
            title: "Search at the intersection",
            summary: "Use research-specific terms.",
            points: ["Agentic workflows", "Biomedical agents"],
          },
        },
        plan: {
          type: "ResultActionPlan",
          props: {
            title: "Next steps",
            phases: [{ timeframe: "now", title: "Configure alerts", actions: ["Track official labs"] }],
          },
        },
        caveats: {
          type: "ResultCaveats",
          props: { items: ["Verify openings on official sites"] },
        },
        evidence: {
          type: "ResultEvidence",
          props: { items: ["Official source list included"] },
        },
      },
    });

    expect(result).toContain("PhD channel guide ready");
    expect(result).toContain("AI Agent × LLM × Bioinformatics PhD Guide");
    expect(result).toContain("Agentic workflows");
    expect(result).toContain("Track official labs");
    expect(result).toContain("Verify openings on official sites");
    expect(result).toContain("Official source list included");
    expect(result).not.toContain("No readable structured result content");
  });
});
