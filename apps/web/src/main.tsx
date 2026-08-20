import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { getQueryClient } from "@/lib/query-client";
import { createAppRouter } from "./router";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-sc";
import "./styles/globals.css";

const queryClient = getQueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createAppRouter()} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
