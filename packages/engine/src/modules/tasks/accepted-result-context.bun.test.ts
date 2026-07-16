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
});
