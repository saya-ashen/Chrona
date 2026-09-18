import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Isolated, deterministic B3 profile. No execution worker or debug provider.
const server = base.webServer;
if (!server || Array.isArray(server) || !server.command) throw new Error("Expected the isolated E2E web server");
export default defineConfig({
  ...base,
  testMatch: /work-results\.spec\.ts/,
  testIgnore: [],
  // /ready intentionally reports unavailable when execution is disabled; health
  // proves API startup for this read/write-only application profile.
  webServer: { ...server, url: server.url?.replace("/api/ready", "/api/health"), command: server.command.replace("CHRONA_ENABLE_DEBUG_PROVIDER=true", "CHRONA_ENABLE_DEBUG_PROVIDER=false")
    .replace("CHRONA_TASK_ORCHESTRATOR_ENABLED=true", "CHRONA_TASK_ORCHESTRATOR_ENABLED=false CHRONA_RESULT_WRITES_ENABLED=true")
    .replace("bun run dev", "bun run e2e/results-server.ts") },
  projects: base.projects?.map((project) => project.name === "chromium" ? { ...project, use: { ...project.use, viewport: { width: 1440, height: 900 } } } : project),
});
