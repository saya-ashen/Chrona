/** The Provider's browser (v2-12): screenshots of pages served on this machine, shown to the model and saved in the cwd. */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; details: undefined };
// Structural subset keeps this extension independent of the host Pi package version.
type BrowserApi = { registerTool(tool: {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute(id: string, params: unknown, signal?: AbortSignal): Promise<ToolResult>;
}): void };
type Params = { url: string; width?: number; height?: number };

// Previews only: the shell can already reach the network, but this tool is for pages the run serves itself.
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;
const size = (value: unknown, fallback: number) => Number.isInteger(value) && (value as number) >= 200 && (value as number) <= 4000 ? value as number : fallback;

function capture(browser: string, args: string[], signal?: AbortSignal) {
  return new Promise<string>((resolveCapture, reject) => {
    const child = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"], shell: false, signal });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); if (code === 0) resolveCapture(stderr); else reject(new Error(`Browser exited with ${code}: ${stderr}`)); });
  });
}

export default function (pi: BrowserApi) {
  const browser = process.env.CHRONA_BROWSER ?? "";
  if (!browser) return;
  let count = 0;
  pi.registerTool({
    name: "browser_screenshot", label: "browser_screenshot",
    description: "Screenshot a page served on this machine (http://127.0.0.1:<port>/..., e.g. a module preview) at a viewport size, after its scripts ran. Returns the image and saves it under screenshots/ in the working directory. Check pages at 1440x900, 1024x768 and 390x844.",
    parameters: { type: "object", properties: {
      url: { type: "string", description: "http://127.0.0.1:<port>/path or http://localhost:<port>/path" },
      width: { type: "integer", minimum: 200, maximum: 4000, description: "Viewport width in CSS pixels (default 1440)" },
      height: { type: "integer", minimum: 200, maximum: 4000, description: "Viewport height in CSS pixels (default 900)" },
    }, required: ["url"], additionalProperties: false },
    async execute(_id, raw, signal) {
      const params = raw as Params;
      if (typeof params.url !== "string" || !LOOPBACK.test(params.url)) throw new Error("Only pages on this machine: http://127.0.0.1:<port>/... or http://localhost:<port>/...");
      const width = size(params.width, 1440), height = size(params.height, 900);
      await mkdir("screenshots", { recursive: true });
      const file = join("screenshots", `${String(++count).padStart(3, "0")}-${width}x${height}.png`);
      const profile = await mkdtemp(join(tmpdir(), "chrona-browser-"));
      try {
        // Virtual time lets the page's fetches and scripts settle before the capture.
        await capture(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
          `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--virtual-time-budget=8000", `--screenshot=${join(process.cwd(), file)}`, params.url], signal);
        const data = (await readFile(file)).toString("base64");
        return { content: [{ type: "text", text: `Saved ${file} (${width}x${height}) of ${params.url}` }, { type: "image", data, mimeType: "image/png" }], details: undefined };
      } finally { await rm(profile, { recursive: true, force: true }); }
    },
  });
}
