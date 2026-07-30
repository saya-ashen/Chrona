import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = import.meta.dir + "/..";
const startupTimeoutMs = 30_000;

interface EntryPoint {
  name: string;
  command: string[];
  url: string;
}

function makeTempDir(): string {
  return join(
    process.env.TMPDIR ?? "/tmp",
    `chrona-entrypoint-smoke-${process.pid}-${crypto.randomUUID()}`,
  );
}

async function waitForReadiness(entrypoint: EntryPoint, output: string[]): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastFailure = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(entrypoint.url);
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(100);
  }

  throw new Error(
    `${entrypoint.name} did not become ready at ${entrypoint.url}: ${lastFailure}\n${output.join("")}`,
  );
}

async function stopProcess(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    child.exited,
    Bun.sleep(5_000).then(() => null),
  ]);
  if (exited === null) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

async function smokeEntrypoint(entrypoint: EntryPoint, tempDir: string): Promise<void> {
  const output: string[] = [];
  const child = Bun.spawn({
    cmd: entrypoint.command,
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: `file:${join(tempDir, `${entrypoint.name}.db`)}`,
      CHRONA_MIGRATIONS_DIR: join(ROOT, "prisma", "migrations"),
      HOME: tempDir,
      HOST: "127.0.0.1",
      PORT: entrypoint.name === "dev:web" ? "34103" : entrypoint.name === "start" ? "34102" : "34101",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const collectOutput = async (stream: ReadableStream<Uint8Array> | null) => {
    if (stream) output.push(await new Response(stream).text());
  };
  const outputCollection = Promise.all([collectOutput(child.stdout), collectOutput(child.stderr)]);

  try {
    await waitForReadiness(entrypoint, output);
  } finally {
    await stopProcess(child);
    await outputCollection;
  }

  if (child.exitCode !== 0 && child.exitCode !== 143) {
    throw new Error(`${entrypoint.name} exited with ${child.exitCode}\n${output.join("")}`);
  }

  console.log(`${entrypoint.name}: ready and stopped cleanly`);
}

const tempDir = makeTempDir();
await mkdir(tempDir, { recursive: true });
await Bun.write(join(tempDir, ".keep"), "");

try {
  await smokeEntrypoint(
    { name: "server:start", command: ["bun", "run", "server:start"], url: "http://127.0.0.1:34101/health" },
    tempDir,
  );
  await smokeEntrypoint(
    { name: "start", command: ["bun", "run", "start"], url: "http://127.0.0.1:34102/health" },
    tempDir,
  );
  await smokeEntrypoint(
    {
      name: "dev:web",
      command: ["bun", "run", "dev:web", "--", "--host", "127.0.0.1", "--port", "34103"],
      url: "http://127.0.0.1:34103/",
    },
    tempDir,
  );
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
