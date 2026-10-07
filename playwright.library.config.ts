import { defineConfig } from "@playwright/test";
import base from "./playwright.pages.config";
const server = base.webServer;
if (!server || Array.isArray(server) || !server.command) throw new Error("Expected isolated page server");
export default defineConfig({ ...base, testMatch: /content-library\.spec\.ts/, testIgnore: [], webServer: { ...server, command: server.command.replace("CHRONA_WORK_PAGES_WRITES_ENABLED=true", "CHRONA_WORK_PAGES_WRITES_ENABLED=true CHRONA_LIBRARY_WRITES_ENABLED=true") } });
