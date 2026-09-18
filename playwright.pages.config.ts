import { defineConfig } from "@playwright/test";
import base from "./playwright.results.config";
const server = base.webServer;
if (!server || Array.isArray(server) || !server.command) throw new Error("Expected isolated result server");
export default defineConfig({
  ...base, testMatch: /work-pages\.spec\.ts/, testIgnore: [],
  webServer: { ...server, command: server.command.replace("CHRONA_RESULT_WRITES_ENABLED=true", "CHRONA_RESULT_WRITES_ENABLED=true CHRONA_WORK_WRITES_ENABLED=true CHRONA_WORK_PAGES_WRITES_ENABLED=true") },
});
