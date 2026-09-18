import { defineConfig } from "@playwright/test";
import results from "./playwright.results.config";
const server = results.webServer;
if (!server || Array.isArray(server) || !server.command) throw new Error("Expected the isolated work test server");
export default defineConfig({
  ...results,
  testMatch: /work-records\.spec\.ts/,
  webServer: { ...server, command: server.command.replace("CHRONA_RESULT_WRITES_ENABLED=true", "CHRONA_RESULT_WRITES_ENABLED=true CHRONA_WORK_WRITES_ENABLED=true") },
  use: { ...results.use, timezoneId: "Asia/Shanghai" },
});
