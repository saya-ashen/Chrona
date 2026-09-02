import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "docs", "assets", "generated");
const TMP_DIR = path.join(ROOT, "docs", "assets", ".tmp");

export const README_MOTION_ASSETS = [
  {
    name: "task-workflow",
    generated: "task-workflow.gif",
    maxBytes: 9_000_000,
    maxWidth: 1120,
  },
  {
    name: "result-review",
    generated: "result-review.gif",
    maxBytes: 7_000_000,
    maxWidth: 1120,
  },
] as const;

function relativePath(file: string) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function installDemoOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.querySelector("#chrona-demo-overlay")) return;
    const style = document.createElement("style");
    style.textContent = `
      #chrona-demo-cursor {
        position: fixed;
        z-index: 2147483647;
        width: 20px;
        height: 20px;
        border: 3px solid white;
        border-radius: 999px;
        background: #6657d9;
        box-shadow: 0 0 0 2px rgba(62, 45, 170, .55), 0 8px 24px rgba(40, 31, 110, .28);
        pointer-events: none;
        transform: translate(1320px, 820px);
        transition: transform 420ms cubic-bezier(.22, 1, .36, 1), box-shadow 160ms ease, opacity 160ms ease;
      }
      #chrona-demo-cursor[data-clicking="true"] {
        box-shadow: 0 0 0 10px rgba(102, 87, 217, .18), 0 8px 24px rgba(40, 31, 110, .28);
      }
      #chrona-demo-caption {
        position: fixed;
        z-index: 2147483646;
        left: 50%;
        bottom: 24px;
        max-width: min(620px, calc(100vw - 64px));
        transform: translateX(-50%);
        border: 1px solid rgba(255, 255, 255, .2);
        border-radius: 999px;
        background: rgba(24, 24, 32, .9);
        color: white;
        padding: 10px 18px;
        font: 600 14px/1.35 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: .01em;
        text-align: center;
        box-shadow: 0 12px 36px rgba(0, 0, 0, .22);
        backdrop-filter: blur(10px);
        pointer-events: none;
        opacity: 0;
        transition: opacity 220ms ease;
      }
      #chrona-demo-caption[data-visible="true"] { opacity: 1; }
      a[href^="/zh"] { display: none !important; }
      * { caret-color: transparent !important; }
    `;
    document.head.append(style);
    const overlay = document.createElement("div");
    overlay.id = "chrona-demo-overlay";
    overlay.innerHTML = '<div id="chrona-demo-cursor"></div><div id="chrona-demo-caption"></div>';
    document.body.append(overlay);
  });
}

async function setDemoCaption(page: Page, text: string) {
  await installDemoOverlay(page);
  await page.evaluate((caption) => {
    const element = document.querySelector<HTMLElement>("#chrona-demo-caption");
    if (!element) return;
    element.textContent = caption;
    element.dataset.visible = "true";
  }, text);
}

async function moveDemoCursor(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Demo target is not visible");
  await page.evaluate(({ x, y }) => {
    const cursor = document.querySelector<HTMLElement>("#chrona-demo-cursor");
    if (cursor) cursor.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
}

async function assertEnglishDemo(page: Page) {
  const language = await page.locator("html").getAttribute("lang");
  if (!language?.toLowerCase().startsWith("en")) {
    throw new Error(`README demo must use the English locale, received ${language ?? "unset"}`);
  }
  const visibleText = await page.locator("body").innerText();
  if (/\p{Script=Han}/u.test(visibleText)) {
    throw new Error("README demo contains visible non-English UI text");
  }
}

async function demoClick(page: Page, target: Locator) {
  await moveDemoCursor(page, target);
  await page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>("#chrona-demo-cursor");
    if (cursor) cursor.dataset.clicking = "true";
  });
  await target.click({ force: true });
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>("#chrona-demo-cursor");
    if (cursor) cursor.dataset.clicking = "false";
  });
}

async function waitForRenderedPlanGraph(
  page: Page,
  testId: string,
  minimumVisibleNodes = 1,
  minimumNodeWidth = 0,
) {
  const graph = page.getByTestId(testId);
  await graph.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(({ graphTestId, requiredVisibleNodes, requiredNodeWidth }) => {
    const frame = document.querySelector<HTMLElement>(`[data-testid="${graphTestId}"]`);
    const flow = frame?.querySelector<HTMLElement>(".react-flow");
    const nodes = Array.from(frame?.querySelectorAll<HTMLElement>(".react-flow__node") ?? []);
    if (!frame || !flow || nodes.length === 0) return false;
    const frameRect = frame.getBoundingClientRect();
    const flowRect = flow.getBoundingClientRect();
    const visibleNodeCount = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= requiredNodeWidth && rect.height > 0
        && rect.right > frameRect.left && rect.left < frameRect.right
        && rect.bottom > frameRect.top && rect.top < frameRect.bottom;
    }).length;
    return frameRect.width >= 400 && frameRect.height >= 280
      && flowRect.width >= 360 && flowRect.height >= 240
      && visibleNodeCount >= requiredVisibleNodes;
  }, {
    graphTestId: testId,
    requiredVisibleNodes: minimumVisibleNodes,
    requiredNodeWidth: minimumNodeWidth,
  }, { timeout: 20_000 });
}

async function captureTaskWorkflow(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/en/tasks`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const search = page.getByRole("searchbox", { name: "Search by title or description" });
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await setDemoCaption(page, "Find an AI-executable task");
  await page.waitForTimeout(1_000);
  await demoClick(page, search);
  await search.pressSequentially("Prepare a GitHub Trending engineering brief", { delay: 28 });
  await page.waitForTimeout(900);

  await setDemoCaption(page, "Open the task workspace");
  const details = page.locator('a[href="/en/tasks/graph-fixture-inactive-branch-tail"]');
  await demoClick(page, details);
  await page.waitForURL(/graph-fixture-inactive-branch-tail/, { timeout: 20_000 });
  await page.getByTestId("task-plan-graph").waitFor({ state: "visible", timeout: 20_000 });
  await installDemoOverlay(page);
  await page.waitForTimeout(1_100);

  await setDemoCaption(page, "Track completed, waiting, and upcoming steps");
  await demoClick(page, page.getByRole("button", { name: "Full Dependencies and all paths" }));
  await waitForRenderedPlanGraph(page, "task-plan-graph");
  await page.waitForTimeout(1_100);

  await setDemoCaption(page, "Open the full plan graph");
  const inlineGraph = page.getByTestId("task-plan-graph");
  await demoClick(page, inlineGraph.getByRole("button", { name: "Expand graph" }));
  await page.getByRole("heading", { name: "Full execution graph" }).waitFor({ state: "visible", timeout: 20_000 });
  await waitForRenderedPlanGraph(page, "task-plan-graph-full-dialog");
  const fullGraph = page.getByTestId("task-plan-graph-full-dialog");
  await demoClick(page, fullGraph.getByRole("button", { name: "Fit graph" }));
  await waitForRenderedPlanGraph(page, "task-plan-graph-full-dialog", 4, 80);
  await page.waitForTimeout(1_200);

  await setDemoCaption(page, "Inspect dependencies at a readable scale");
  await demoClick(page, fullGraph.getByRole("button", { name: /Analyze technology themes/ }));
  await page.waitForTimeout(2_000);
}

async function captureResultReview(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/en/tasks/graph-fixture-completed-research-brief`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const reviewHeading = page.getByRole("heading", { name: "Execution complete, awaiting review" });
  await reviewHeading.waitFor({ state: "visible", timeout: 20_000 });
  await setDemoCaption(page, "Review the generated result");
  await page.waitForTimeout(1_400);

  const representativeProjects = page.getByText("Representative projects", { exact: true });
  await setDemoCaption(page, "Inspect evidence and recommendations");
  await moveDemoCursor(page, representativeProjects);
  await page.waitForTimeout(1_500);
  const followUp = page.getByText("Recommended follow-up", { exact: true });
  await moveDemoCursor(page, followUp);
  await page.waitForTimeout(1_500);

  await reviewHeading.scrollIntoViewIfNeeded();
  await setDemoCaption(page, "Accept the result when it is ready");
  await demoClick(page, page.getByRole("button", { name: "Accept result" }));
  await page.getByRole("heading", { name: "Confirm result acceptance" }).waitFor({ state: "visible" });
  await page.waitForTimeout(700);
  await demoClick(page, page.getByRole("button", { name: "Confirm acceptance" }));
  await page.getByRole("heading", { name: "Result accepted" }).waitFor({ state: "visible", timeout: 20_000 });
  const close = page.getByRole("button", { name: "Close" });
  if (await close.isVisible()) await demoClick(page, close);
  await setDemoCaption(page, "Keep the accepted result with the task");
  await page.waitForTimeout(1_700);
}

function resolveFfmpegExecutable() {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe", "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe"]
    : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/opt/local/bin/ffmpeg", "/run/current-system/sw/bin/ffmpeg"];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("ffmpeg was not found in a trusted system installation directory");
  return executable;
}

function runFfmpeg(args: string[]) {
  const executable = resolveFfmpegExecutable();
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status === 0) return;
  if (result.stdout.trim()) console.error(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  throw new Error(`ffmpeg failed: ffmpeg ${args.join(" ")}`);
}

function renderMotionGif(input: string, output: string, maxBytes: number) {
  const profiles = [
    { fps: 10, width: 1120, colors: 96 },
    { fps: 8, width: 1040, colors: 80 },
    { fps: 7, width: 960, colors: 64 },
  ];
  for (const profile of profiles) {
    runFfmpeg([
      "-y",
      "-i",
      input,
      "-ss",
      "3.0",
      "-filter_complex",
      `fps=${profile.fps},scale=${profile.width}:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${profile.colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
      "-loop",
      "0",
      output,
    ]);
    if (fs.statSync(output).size <= maxBytes) return;
  }
  throw new Error(`${relativePath(output)} exceeds ${maxBytes} bytes after all optimization profiles`);
}

async function recordMotionAsset(
  browser: Browser,
  baseUrl: string,
  asset: (typeof README_MOTION_ASSETS)[number],
  scenario: (page: Page, baseUrl: string) => Promise<void>,
) {
  const videoDir = path.join(TMP_DIR, "video", asset.name);
  fs.mkdirSync(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "no-preference",
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await scenario(page, baseUrl);
    await assertEnglishDemo(page);
  } finally {
    await context.close();
  }
  if (!video) throw new Error(`Playwright did not create a video for ${asset.name}`);
  const recorded = await video.path();
  const rawVideo = path.join(TMP_DIR, `${asset.name}.webm`);
  fs.copyFileSync(recorded, rawVideo);
  const output = path.join(GENERATED_DIR, asset.generated);
  renderMotionGif(rawVideo, output, asset.maxBytes);
  console.log(`rendered ${relativePath(output)} (${fs.statSync(output).size} bytes)`);
}

export async function captureReadmeMotion(input: {
  baseUrl: string;
  headed: boolean;
  executablePath?: string;
}) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: !input.headed, executablePath: input.executablePath });
    const warmupContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
    const warmupPage = await warmupContext.newPage();
    await warmupPage.goto(`${input.baseUrl}/en/tasks`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await warmupPage.getByRole("heading", { name: "Tasks" }).waitFor({ state: "visible", timeout: 20_000 });
    await warmupContext.close();

    await recordMotionAsset(browser, input.baseUrl, README_MOTION_ASSETS[0], captureTaskWorkflow);
    await recordMotionAsset(browser, input.baseUrl, README_MOTION_ASSETS[1], captureResultReview);
  } finally {
    await browser?.close();
  }
}
