import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WORK_TOOLS, WORK_WEB_TOOLS } from "@chrona/contracts/steward";
import { createPiAgentRunner, resolvePiAgentExtension } from "./pi-agent-runner";

const agentUrl = "http://127.0.0.1:3101/api/steward-agent";
const token = "test-only-attempt-token";
const envKeys = ["API_KEY", "DATABASE_URL", "CHRONA_TEST_SECRET", "CHRONA_STEWARD_PI_AGENT_EXTENSION", "CHRONA_RESOURCE_DIR"] as const;
let directory: string;
let previousEnv: (string | undefined)[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "chrona-pi-runner-test-"));
  previousEnv = envKeys.map(key => process.env[key]);
});
afterEach(() => {
  envKeys.forEach((key, index) => {
    if (previousEnv[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[index];
  });
  rmSync(directory, { recursive: true, force: true });
});

type Report = { args: string[]; cwd: string; entries: string[]; pid: number; env: Record<string, string>; stdin: string };
function fakePi(body = 'process.stdout.write("normal exit");') {
  const reportPath = join(directory, "report.json");
  const command = join(directory, "fake-pi");
  // TEST ONLY. This executable never invokes Pi, models, HTTP or real tools.
  writeFileSync(command, `#!${process.execPath}
import { readdirSync, writeFileSync, readFileSync } from "node:fs";
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key === "API_KEY" || key === "DATABASE_URL" || key.startsWith("CHRONA_")));
writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), entries: readdirSync(process.cwd()), pid: process.pid, env, stdin: readFileSync(0, "utf8") }));
${body}
`);
  chmodSync(command, 0o700);
  return { command, report: () => JSON.parse(readFileSync(reportPath, "utf8")) as Report };
}
function runner(command: string, extra: Partial<Parameters<typeof createPiAgentRunner>[0]> = {}) {
  return createPiAgentRunner({ command, extensionPath: join(directory, "chrona-tools.ts"), agentUrl, timeoutMs: 10_000, ...extra });
}
function input(extra: Partial<Parameters<ReturnType<typeof createPiAgentRunner>["run"]>[0]> = {}) {
  return { token, deadlineAt: new Date(Date.now() + 10_000), shouldStop: async () => false, ...extra };
}
function assertGone(report: Report) {
  expect(existsSync(report.cwd)).toBe(false);
  expect(() => process.kill(report.pid, 0)).toThrow();
}

describe("Pi agent runner (fake executables only)", () => {
  test("normal exit: exact scoped tools, isolation flags, minimal env and disposable empty cwd", async () => {
    process.env.API_KEY = "test-only-api-key";
    process.env.DATABASE_URL = "test-only-database-url";
    process.env.CHRONA_TEST_SECRET = "test-only-secret";
    const fake = fakePi();
    const agent = runner(fake.command, { model: "test/model" });
    expect(agent.name).toBe("pi-agent-v1");
    expect(await agent.run(input())).toEqual({ outcome: "exited", note: "normal exit" });
    const report = fake.report();
    expect(report.args.slice(0, 9)).toEqual(["-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-builtin-tools", "--offline"]);
    expect(report.args.filter(value => value === "-e")).toHaveLength(1);
    expect(report.args[report.args.indexOf("-e") + 1]).toBe(join(directory, "chrona-tools.ts"));
    expect(report.args[report.args.indexOf("--tools") + 1]).toBe(WORK_TOOLS.join(","));
    expect(report.args).not.toContain("--approve");
    expect(report.args[report.args.indexOf("--model") + 1]).toBe("test/model");
    const systemPrompt = report.args[report.args.indexOf("--system-prompt") + 1]!;
    expect(systemPrompt.length).toBeLessThanOrEqual(3500);
    expect(systemPrompt).toContain("untrusted data");
    expect(systemPrompt).toContain("handling");
    expect(report.args.at(-1)).toBe("Handle the Chrona work item now. Start with chrona_get_context, then act. End the run by calling exactly one of: chrona_publish_result, chrona_ask_user, chrona_request_authorization, chrona_close_quietly.");
    expect(report.env).toEqual({ CHRONA_AGENT_URL: agentUrl, CHRONA_AGENT_TOKEN: token });
    expect(report.stdin).toBe("");
    expect(report.entries).toEqual([]);
    expect(report.cwd).not.toBe(process.cwd());
    assertGone(report);
  });

  test("existing web extension adds exactly the two web tools and second -e", async () => {
    const fake = fakePi();
    const webExtensionPath = join(directory, "web.ts");
    writeFileSync(webExtensionPath, "// test-only extension placeholder");
    expect((await runner(fake.command, { webExtensionPath }).run(input())).outcome).toBe("exited");
    const { args } = fake.report();
    expect(args[args.indexOf("--tools") + 1]).toBe([...WORK_TOOLS, ...WORK_WEB_TOOLS].join(","));
    expect(args.flatMap((arg, index) => arg === "-e" ? [args[index + 1]] : [])).toEqual([join(directory, "chrona-tools.ts"), webExtensionPath]);
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--approve");
  });

  test("missing web extension does not enable web tools", async () => {
    const fake = fakePi();
    await runner(fake.command, { webExtensionPath: join(directory, "absent.ts") }).run(input());
    const { args } = fake.report();
    expect(args[args.indexOf("--tools") + 1]).toBe(WORK_TOOLS.join(","));
    expect(args.filter(arg => arg === "-e")).toHaveLength(1);
  });

  test("deadline kills the process and removes cwd", async () => {
    const fake = fakePi('setInterval(() => {}, 1000);');
    const result = await runner(fake.command).run(input({ deadlineAt: new Date(Date.now() + 700) }));
    expect(result.outcome).toBe("timeout");
    assertGone(fake.report());
  });

  test("configured timeout caps a later deadline", async () => {
    const fake = fakePi('setInterval(() => {}, 1000);');
    expect((await runner(fake.command, { timeoutMs: 700 }).run(input())).outcome).toBe("timeout");
    assertGone(fake.report());
  });

  test("expired deadline never starts a process", async () => {
    const fake = fakePi();
    expect(await runner(fake.command).run(input({ deadlineAt: new Date(0) }))).toEqual({ outcome: "timeout", note: "" });
    expect(() => fake.report()).toThrow();
  });

  test("shouldStop poll kills the process", async () => {
    const fake = fakePi('setInterval(() => {}, 1000);');
    let polls = 0;
    expect((await runner(fake.command).run(input({ shouldStop: async () => { polls++; return true; } }))).outcome).toBe("killed");
    expect(polls).toBe(1);
    assertGone(fake.report());
  });

  test("shouldStop rejection fails closed", async () => {
    const fake = fakePi('setInterval(() => {}, 1000);');
    expect((await runner(fake.command).run(input({ shouldStop: async () => { throw new Error("test-only check failure"); } }))).outcome).toBe("killed");
    assertGone(fake.report());
  });

  test("missing executable is unavailable", async () => {
    expect(await runner(join(directory, "missing-pi")).run(input())).toEqual({ outcome: "unavailable", note: "" });
  });

  test("fast non-zero exit is unavailable", async () => {
    const fake = fakePi('process.stdout.write("startup failed"); process.exit(7);');
    expect(await runner(fake.command).run(input())).toEqual({ outcome: "unavailable", note: "startup failed" });
    assertGone(fake.report());
  });

  test("non-zero exit after startup window is exited", async () => {
    const fake = fakePi('setTimeout(() => process.exit(7), 3100);');
    expect((await runner(fake.command).run(input())).outcome).toBe("exited");
    assertGone(fake.report());
  });

  test("large stdout is drained, retaining a sanitized <=300-character tail; stderr discarded", async () => {
    const fake = fakePi('process.stdout.write("x".repeat(200_000)); process.stdout.write("\\u001b[31mTAIL\\u001b[0m\\n\\t\\u0000" + process.env.CHRONA_AGENT_TOKEN); process.stderr.write("ignored stderr");');
    const result = await runner(fake.command).run(input());
    expect(result.outcome).toBe("exited");
    expect(result.note).toHaveLength(300);
    expect(result.note.endsWith("TAIL[redacted]")).toBe(true);
    expect(result.note).not.toMatch(/\p{Cc}/u);
    expect(result.note).not.toContain(token);
    expect(result.note).not.toContain("ignored stderr");
    assertGone(fake.report());
  });

  test("invalid timeout configuration is rejected", () => {
    for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) expect(() => runner("unused-test-only", { timeoutMs })).toThrow("Invalid Pi timeout");
  });
});

describe("Pi extension resolution", () => {
  test("explicit existing file wins, invalid override falls through to resource dir", () => {
    const explicit = join(directory, "explicit.ts");
    const resource = join(directory, "external-plugins/pi-steward-agent/chrona-tools.ts");
    mkdirSync(join(directory, "external-plugins/pi-steward-agent"), { recursive: true });
    writeFileSync(explicit, "// test-only");
    writeFileSync(resource, "// test-only");
    process.env.CHRONA_STEWARD_PI_AGENT_EXTENSION = explicit;
    process.env.CHRONA_RESOURCE_DIR = directory;
    expect(resolvePiAgentExtension()).toBe(explicit);
    process.env.CHRONA_STEWARD_PI_AGENT_EXTENSION = join(directory, "missing.ts");
    expect(resolvePiAgentExtension()).toBe(resource);
    process.env.CHRONA_STEWARD_PI_AGENT_EXTENSION = directory;
    expect(resolvePiAgentExtension()).toBe(resource);
  });

  test("binary resources precede repo fallback", () => {
    delete process.env.CHRONA_STEWARD_PI_AGENT_EXTENSION;
    delete process.env.CHRONA_RESOURCE_DIR;
    const bundled = join(directory, "resources/external-plugins/pi-steward-agent/chrona-tools.ts");
    mkdirSync(join(directory, "resources/external-plugins/pi-steward-agent"), { recursive: true });
    writeFileSync(bundled, "// test-only");
    const originalBinary = Bun.argv[0];
    try {
      Bun.argv[0] = join(directory, "chrona-test-only");
      expect(resolvePiAgentExtension()).toBe(bundled);
    } finally {
      Bun.argv[0] = originalBinary!;
    }
  });

  test("repo-relative fallback resolves the supervisor-owned extension", () => {
    delete process.env.CHRONA_STEWARD_PI_AGENT_EXTENSION;
    delete process.env.CHRONA_RESOURCE_DIR;
    expect(resolvePiAgentExtension()).toBe(resolve(import.meta.dirname, "../../../../external-plugins/pi-steward-agent/chrona-tools.ts"));
  });
});

test("an empty stdout keeps a sanitized stderr tail for diagnosis, never the token", async () => {
  const fake = fakePi('process.stderr.write("provider error: rate limited " + process.env.CHRONA_AGENT_TOKEN); process.exit(0);');
  const result = await runner(fake.command).run(input());
  expect(result.note).toContain("provider error: rate limited");
  expect(result.note).toContain("[redacted]");
});
