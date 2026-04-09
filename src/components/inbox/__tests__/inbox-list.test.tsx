import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InboxList } from "@/components/inbox/inbox-list";

describe("InboxList", () => {
  it("shows action type, risk, task, run, summary, and consequence", () => {
    render(
      <InboxList
        items={[
          {
            id: "approval_1",
            actionType: "approval",
            riskLevel: "high",
            sourceTaskTitle: "Review adapter mapping",
            currentRunLabel: "run_projection",
            summary: "Approve the file patch",
            consequence: "Blocks deployment until approved",
          },
        ]}
      />,
    );

    expect(screen.getByText("approval")).toBeInTheDocument();
    expect(screen.getByText(/Risk: high/i)).toBeInTheDocument();
    expect(screen.getByText(/Task: Review adapter mapping/i)).toBeInTheDocument();
    expect(screen.getByText("Approve the file patch")).toBeInTheDocument();
    expect(screen.getByText("Blocks deployment until approved")).toBeInTheDocument();
  });
});
