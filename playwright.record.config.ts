import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for recording README demo GIFs.
 *
 * Usage:
 *   # 1. Start the Chrona server in another terminal:
 *   #    bun run dev   (or: node dist/cli.js start)
 *
 *   # 2. Run the recordings:
 *   #    bunx playwright test --config=playwright.record.config.ts
 *
 *   # 3. Videos are written to artifacts/demo/videos/
 *   #    Convert to GIF:
 *   #    ffmpeg -y -ss START -i video.webm -t DURATION \
 *   #      -vf "fps=10,scale=640:-1:flags=lanczos" output.gif
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["demo-record.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "artifacts/demo/playwright",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "off",
    video: "on",
    viewport: { width: 1440, height: 1080 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
