import { createElement, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithQueryClient(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createTestQueryClient();

  return {
    queryClient,
    ...render(
      createElement(QueryClientProvider, { client: queryClient }, ui),
      options,
    ),
  };
}
