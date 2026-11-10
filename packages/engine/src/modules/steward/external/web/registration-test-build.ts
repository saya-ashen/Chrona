import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Build in a Chrona checkout; the resulting single file needs only Bun and the app under test. */
export async function buildRegistrationTest(outdir: string) {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dirname, "registration-test.ts")],
    target: "bun", format: "esm", packages: "bundle", minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Cannot build portable Web registration test support");
  const path = join(resolve(outdir), "registration-test.mjs");
  await mkdir(resolve(outdir), { recursive: true });
  await Bun.write(path, await result.outputs[0]!.text());
  return path;
}
