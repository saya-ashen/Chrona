import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTestQueryClient, renderWithQueryClient } from "./fixtures";

function QueryClientProbe() {
  const queryClient = useQueryClient();
  queryClient.setQueryData(["fixture"], "ready");

  return <div>{queryClient.getQueryData(["fixture"])}</div>;
}

describe("frontend test fixtures", () => {
  it("creates React Query clients with retries disabled", () => {
    const queryClient = createTestQueryClient();

    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("renders components inside a QueryClientProvider", () => {
    const { queryClient } = renderWithQueryClient(<QueryClientProbe />);

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(queryClient.getQueryData(["fixture"])).toBe("ready");
  });
});
