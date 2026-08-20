import { expect, test, type Page } from "@playwright/test";

const ROUTES = [
  "/en/dashboard",
  "/en/schedule",
  "/en/tasks",
  "/en/action-center",
  "/en/goals",
  "/en/settings",
] as const;

const PRIVATE_DATA_PATTERNS = [
  /"(?:apiKey|runToken|providerRequestBody|rawToolPayload)"\s*:/i,
  /(?:sk-[a-z0-9]{8,}|Bearer\s+[a-z0-9._-]{12,})/i,
  /(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)/,
];

function findPrivateData(value: string) {
  return (
    PRIVATE_DATA_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null
  );
}

async function expectNoHorizontalScroll(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.scrollWidth > window.innerWidth,
        document: document.documentElement.scrollWidth > window.innerWidth,
      })),
    )
    .toEqual({ body: false, document: false });
}

test.describe("privacy surface audit", () => {
  test.setTimeout(120_000);

  test("[CROSS-010] keeps private runtime data out of UI, captures, logs, and network surfaces", async ({
    page,
  }, testInfo) => {
    const findings: string[] = [];
    const responseChecks: Promise<void>[] = [];
    const inspect = (surface: string, value: string | undefined) => {
      if (!value) return;
      const match = findPrivateData(value);
      if (match) findings.push(`${surface}: ${match}`);
    };

    page.on("console", (message) => inspect("console", message.text()));
    page.on("pageerror", (error) => inspect("pageerror", error.message));
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith("/api/")) return;
      inspect(
        "request",
        `${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ""}`,
      );
    });
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith("/api/")) return;
      if (
        response.headers()["content-type"]?.includes("text/event-stream")
      ) {
        return;
      }
      responseChecks.push(
        (async () => {
          inspect("response-url", response.url());
          let body = "";
          try {
            body = await response.text();
          } catch {
            // Response may close while navigation advances.
          }
          inspect("response-body", body.slice(0, 250_000));
        })(),
      );
    });

    for (const route of ROUTES) {
      await test.step(`audit ${route}`, async () => {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".chrona-app-main")).toBeVisible();
        await expect(page.getByText("Page not found")).toHaveCount(0);
        inspect("dom", await page.locator("body").innerText());
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: testInfo.outputPath(
            `cross-010-${route.split("/").pop() || "root"}.png`,
          ),
          animations: "disabled",
        });
      });
    }

    await Promise.all(responseChecks);
    expect(findings).toEqual([]);
  });
});
