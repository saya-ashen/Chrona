import { expect, test } from "bun:test";
import { resolve } from "node:path";

for (const key of [undefined, "", " \t\n", "container-test-key"]) {
  test(`container entrypoint ${key?.trim() ? "accepts a key without logging it" : `rejects ${JSON.stringify(key)}`}`, async () => {
    const child = Bun.spawn(["sh", resolve(import.meta.dirname, "docker-entrypoint.sh"), "sh", "-c", "printf started; exit 7"], {
      env: { PATH: process.env.PATH, ...(key === undefined ? {} : { API_KEY: key }) },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (key?.trim()) {
      expect(code).toBe(7);
      expect(stdout).toBe("started");
      expect(stderr).toBe("");
      expect(stdout + stderr).not.toContain(key);
    } else {
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("API_KEY is required");
    }
  });
}
