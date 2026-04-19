import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AutomationSuggestionPanel } from "../automation-suggestion-panel";

describe("AutomationSuggestionPanel", () => {
  it("renders nothing when the legacy panel is disabled", () => {
    const { container } = render(
      <AutomationSuggestionPanel suggestion={null} isLoading={false} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
