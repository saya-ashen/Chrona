import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProviderAdapter } from "@chrona/contracts/steward";

/** Deterministic browser-test seam. Never selected outside the explicit E2E gate. */
export function createStewardE2eProvider(port: number): ProviderAdapter {
  return {
    name: "e2e",
    async health() { return { available: true, sandboxed: false, error: null }; },
    start(input) {
      const controller = new AbortController();
      async function call(name: string, body: unknown) {
        const response = await fetch(`http://127.0.0.1:${port}/api/steward-agent/tools/${name}`, {
          method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify(body), signal: controller.signal,
        });
        if (!response.ok) throw new Error(`E2E tool ${name}: ${response.status}`);
        return (await response.json() as { data: { id: string; path: string } }).data;
      }
      async function reply(message: string) {
        if (message.includes("规划")) {
          const affair = await call("chrona_affair_create", { title: "十天学习规划", readme: "# 学习规划\n\n每天学习，逐步完成。\n\n- [ ] 阅读学习目标\n" });
          const cwd = resolve(input.cwd, affair.path);
          await writeFile(resolve(cwd, "day-1.md"), "# 第一天\n\n- [ ] 完成第一天练习\n");
          // Root runs are not affair-bound; commit this fixture's native file write.
          for (const args of [["add", "--", "day-1.md"], ["commit", "-m", "Create day page"]]) {
            const process = Bun.spawn(["git", "-c", "user.name=Chrona", "-c", "user.email=chrona@local", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
            if (await process.exited !== 0) throw new Error("E2E fixture commit failed");
          }
          await call("chrona_schedule", { affairId: affair.id, mode: "remind", rule: { kind: "daily", time: "08:00" }, text: "开始今天的学习", label: "每日学习提醒" });
          await call("chrona_reply", { text: "已建好规划" });
        } else await call("chrona_reply", { text: "收到" });
      }
      const trigger = input.prompt.split("\n\nTrigger: message\n").at(-1) ?? input.prompt;
      const done = (input.lane === "foreground" ? reply(trigger) : Promise.resolve())
        .then(() => ({ outcome: "finished" as const, sessionId: null, error: null }))
        .catch(() => ({ outcome: "failed" as const, sessionId: null, error: "E2E provider failed" }));
      return { done, inject: reply, async abort() { controller.abort(); } };
    },
  };
}
