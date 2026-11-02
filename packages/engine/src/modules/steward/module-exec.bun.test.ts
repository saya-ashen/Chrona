import { expect, test } from "bun:test";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startModule } from "../../../../integrations/src/steward/module-sdk/testing";

type Options = {
  tokenEnv?: Record<string, { secret: string; provider: "google" | "microsoft"; account?: string }>;
  secretEnv?: Record<string, { secret: string; field: string }>;
  secretFiles?: Record<string, { secret: string; field: string }>;
  env?: Record<string, string>; cwd?: string; stdin?: string; timeoutMs?: number; maxOutputBytes?: number;
};
type Result = { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };
const credentials = { password: "test-password-very-private", longer: "test-password-very-private-suffix", empty: "", user: "alice@example.com" };
const reference = { secret: "mail", field: "password" };
const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk/sdk.ts");

async function fixture(run: (context: {
  dir: string; module: Awaited<ReturnType<typeof startModule>>;
  exec(command: string, args?: string[], options?: Options): Promise<{ output?: Result; error?: string; code?: string; ownEnv?: string | null }>;
}) => Promise<void>, { secrets = ["mail"], configured = true }: { secrets?: string[]; configured?: boolean } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), "chrona-exec-test-"));
  let module: Awaited<ReturnType<typeof startModule>> | undefined;
  const previous = process.env.CHRONA_MODULE;
  try {
    await fs.writeFile(join(dir, "module.json"), JSON.stringify({ effects: [], uses: ["secrets.get"], secrets }));
    await fs.writeFile(join(dir, "index.ts"), `
import { chrona, on } from ${JSON.stringify(sdk)};
on("tool", async ({ args }) => {
  try { return { result: { output: await chrona.exec(args.command, args.args, args.options), ownEnv: process.env.CHRONA_EXEC_SECRET ?? null } }; }
  catch (error) { return { result: { error: error.message, code: error.code } }; }
});
`);
    process.env.CHRONA_MODULE = dir;
    module = await startModule(join(dir, "index.ts"), { stubs: configured ? { secret: () => ({ value: credentials }), "secrets.token": (params: Record<string, unknown>) => ({ accessToken: `token-for-${params.account ?? "default"}-very-private`, expiresAt: "2026-11-02T04:00:00Z" }) } : {} });
    if (previous === undefined) delete process.env.CHRONA_MODULE; else process.env.CHRONA_MODULE = previous;
    const active = module;
    await run({ dir, module, async exec(command, args = [], options = {}) {
      const now = new Date().toISOString();
      const reply = await active.send({ trigger: { kind: "tool", id: "exec", firedAt: now, args: { command, args, options } }, now, params: {} });
      expect(reply.error).toBeUndefined();
      return reply.result?.result as { output?: Result; error?: string; code?: string; ownEnv?: string | null };
    } });
  } finally {
    if (previous === undefined) delete process.env.CHRONA_MODULE; else process.env.CHRONA_MODULE = previous;
    await module?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("exec passes credentials only to the child, merges env, and fetches each secret once", async () => {
  await fixture(async ({ dir, module, exec }) => {
    const reply = await exec("sh", ["-c", 'test "$CHRONA_EXEC_SECRET" = "$ALIAS" && test "$ALIAS" = "test-password-very-private" && test -n "$PATH" && test "$PLAIN" = plain && test "$PWD" = "$EXPECTED_CWD" && test "$(cat)" = input && printf ok'], {
      secretEnv: { CHRONA_EXEC_SECRET: reference, ALIAS: reference }, secretFiles: { SECRET_FILE: reference },
      env: { CHRONA_EXEC_SECRET: "overridden", PLAIN: "plain", EXPECTED_CWD: dir }, cwd: dir, stdin: "input",
    });
    expect(reply.output).toEqual({ code: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, truncated: false });
    expect(reply.ownEnv).toBe(process.env.CHRONA_EXEC_SECRET ?? null);
    expect(module.calls.filter(call => call.params.target === "secrets.get")).toHaveLength(1);
    // Arguments are passed literally, not interpreted by a shell.
    expect((await exec("printf", ["%s", "$(printf shell); *"])).output?.stdout).toBe("$(printf shell); *");
  });
});

for (const scenario of [
  { name: "undeclared", secrets: ["another"], configured: true, field: "password", code: "forbidden" },
  { name: "unconfigured", secrets: ["mail"], configured: false, field: "password", code: "unavailable" },
  { name: "missing field", secrets: ["mail"], configured: true, field: "missing", code: undefined },
]) test(`exec rejects ${scenario.name} before starting a child without leaking values`, async () => {
  await fixture(async ({ dir, exec }) => {
    const marker = join(dir, "started");
    const reply = await exec("sh", ["-c", 'printf started > "$MARKER"'], {
      secretEnv: { CHRONA_EXEC_SECRET: { secret: "mail", field: scenario.field } }, env: { MARKER: marker },
    });
    expect(reply.output).toBeUndefined();
    expect(reply.error).toBeString();
    expect(reply.code).toBe(scenario.code);
    for (const value of Object.values(credentials).filter(Boolean)) expect(reply.error).not.toContain(value);
    if (scenario.name === "missing field") {
      expect(reply.error).toBe("Missing secret field: mail.missing");
    }
    expect(existsSync(marker)).toBe(false);
  }, scenario);
});

for (const code of [0, 7]) test(`exec creates private secret files and removes them after exit ${code}`, async () => {
  await fixture(async ({ exec }) => {
    const reply = await exec("sh", ["-c", `printf '%s\\n' "$SECRET_FILE"; stat -c %a "$SECRET_FILE"; stat -c %a "$(dirname "$SECRET_FILE")"; cat "$SECRET_FILE"; exit ${code}`], {
      secretFiles: { SECRET_FILE: reference },
    });
    expect(reply.error).toBeUndefined();
    const [path, fileMode, dirMode, value] = reply.output!.stdout.split("\n");
    expect(fileMode).toBe("600");
    expect(dirMode).toBe("700");
    expect(value).toBe("[redacted]");
    expect(dirname(path!)).toStartWith(join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "chrona-exec-"));
    expect(existsSync(dirname(path!))).toBe(false);
    expect(reply.output?.code).toBe(code);
  });
});

test("exec redacts stdout and stderr, longest values first, skipping empty values", async () => {
  await fixture(async ({ exec }) => {
    const reply = await exec("sh", ["-c", 'printf "%s/%s/end" "$LONG" "$SHORT"; printf "%s/%s/end" "$SHORT" "$LONG" >&2'], {
      secretEnv: { SHORT: reference, LONG: { secret: "mail", field: "longer" }, EMPTY: { secret: "mail", field: "empty" } },
    });
    expect(reply.output?.stdout).toBe("[redacted]/[redacted]/end");
    expect(reply.output?.stderr).toBe("[redacted]/[redacted]/end");
  });
});

test("exec redacts only delivered fields, and a value cut by the cap leaks no prefix", async () => {
  await fixture(async ({ exec }) => {
    const shown = await exec("sh", ["-c", 'printf "alice@example.com %s" "$PASS"'], { secretEnv: { PASS: reference } });
    expect(shown.output?.stdout).toBe("alice@example.com [redacted]");
    const cut = await exec("sh", ["-c", 'printf "ab%s" "$PASS"'], { secretEnv: { PASS: reference }, maxOutputBytes: 10 });
    expect(cut.output).toMatchObject({ stdout: "ab[redacte", truncated: true });
    // Earlier replacements shorten the text, so a value cut at the end of the kept bytes must not survive under the cap.
    const repeated = await exec("sh", ["-c", 'for i in 1 2 3 4 5 6; do printf "%s" "$PASS"; done'], { secretEnv: { PASS: reference }, maxOutputBytes: 100 });
    expect(repeated.output?.stdout).not.toMatch(/\]t(e(s(t(-(p(a(s(s)?)?)?)?)?)?)?)?$/);
    expect(repeated.output?.stdout.replaceAll("[redacted]", "")).toBe("");
  });
});

test("exec passes an OAuth access token from secrets.token and redacts it", async () => {
  await fixture(async ({ module, exec }) => {
    const reply = await exec("sh", ["-c", 'test "$MAIL_TOKEN" = token-for-work-very-private && printf "%s" "$MAIL_TOKEN"'], {
      tokenEnv: { MAIL_TOKEN: { secret: "mail", provider: "google", account: "work" } },
    });
    expect(reply.output).toMatchObject({ code: 0, stdout: "[redacted]" });
    expect(module.calls.find(call => call.params.target === "secrets.token")?.params.args).toEqual({ name: "mail", provider: "google", account: "work" });
  });
  await fixture(async ({ exec }) => {
    const reply = await exec("true", [], { tokenEnv: { MAIL_TOKEN: { secret: "mail", provider: "google" } } });
    expect(reply).toMatchObject({ code: "unavailable" });
  }, { configured: false });
});

test("exec timeout kills the process group and removes secret files", async () => {
  await fixture(async ({ dir, exec }) => {
    const marker = join(dir, "survived");
    const reply = await exec("sh", ["-c", 'printf "%s\\n%s\\n" "$SECRET_FILE" "$$"; (sleep 0.6; printf survived > "$MARKER") & wait'], {
      secretFiles: { SECRET_FILE: reference }, env: { MARKER: marker }, timeoutMs: 200,
    });
    expect(reply.error).toBeUndefined();
    expect(reply.output).toMatchObject({ code: null, signal: "SIGKILL", timedOut: true, truncated: false });
    const [path, pid] = reply.output!.stdout.trim().split("\n");
    expect(path).toBeTruthy();
    expect(existsSync(dirname(path!))).toBe(false);
    expect(() => process.kill(Number(pid), 0)).toThrow();
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(existsSync(marker)).toBe(false);
  });
});

test("exec caps each output stream independently and reports truncation", async () => {
  await fixture(async ({ exec }) => {
    const reply = await exec("sh", ["-c", 'printf 123456789; printf abcdefghi >&2'], { maxOutputBytes: 5 });
    expect(reply.output).toEqual({ code: 0, signal: null, stdout: "12345", stderr: "abcde", timedOut: false, truncated: true });
    const exact = await exec("printf", ["12345"], { maxOutputBytes: 5 });
    expect(exact.output?.truncated).toBe(false);
    const zero = await exec("printf", ["x"], { maxOutputBytes: 0 });
    expect(zero.output).toMatchObject({ stdout: "", truncated: true });
  });
});

test("exec spawn failure rejects without secret values and cleans up secret files", async () => {
  await fixture(async ({ exec }) => {
    const root = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
    const before = (await fs.readdir(root)).filter(name => name.startsWith("chrona-exec-"));
    const reply = await exec(`/nonexistent/${credentials.password}`, [], { secretFiles: { SECRET_FILE: reference }, secretEnv: { CHRONA_EXEC_SECRET: reference } });
    expect(reply.output).toBeUndefined();
    expect(reply.error).toBe("Command failed to start");
    expect((await fs.readdir(root)).filter(name => name.startsWith("chrona-exec-"))).toEqual(before);
  });
});
