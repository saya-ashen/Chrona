import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "@/styles/globals.css";

import { ErrorBoundary } from "@/components/error-boundary";
import { createAppRouter } from "./router";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={createAppRouter()} />
    </ErrorBoundary>
  </React.StrictMode>,
);
