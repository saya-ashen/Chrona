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
        if (message.includes("交互验收")) {
          if (!input.events) throw new Error("Missing E2E event bridge");
          await input.events.resources({ version: "0.0.0-fixture", skills: ["fixture-only"], extensions: 0 });
          for (const method of ["confirm", "select", "input", "editor"] as const) {
            await input.events.progress({ phase: "waiting", tool: null });
            const answer = await input.events.question({ method, title: `演示请求 ${method}`, message: "仅测试，不执行任何外部动作", options: method === "select" ? ["选项甲", "选项乙"] : [], ...(method === "editor" ? { prefill: "演示原文\n请修改后交回" } : {}), timeoutMs: 120_000 }, controller.signal);
            if (answer.decision === "cancel") { await call("chrona_reply", { text: "演示请求已关闭，未执行外部动作" }); return; }
          }
          await input.events.usage({ scope: "run", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, contextTokens: null, contextWindow: null });
          await call("chrona_reply", { text: "四项演示答复已收到，未执行外部动作" });
        } else if (message.includes("规划")) {
          const affair = await call("chrona_affair_create", { title: "十天学习规划", readme: "# 学习规划\n\n每天学习，逐步完成。\n\n- [ ] 阅读学习目标\n" });
          const cwd = resolve(input.cwd, affair.path);
          await writeFile(resolve(cwd, "day-1.md"), "# 第一天\n\n- [ ] 完成第一天练习\n");
          // Root runs are not affair-bound; commit this fixture's native file write.
          for (const args of [["add", "--", "day-1.md"], ["commit", "-m", "Create day page"]]) {
            const process = Bun.spawn(["git", "-c", "user.name=Chrona", "-c", "user.email=chrona@local", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
            if (await process.exited !== 0) throw new Error("E2E fixture commit failed");
          }
          await call("chrona_ui_set", { affairId: affair.id, path: "home.ui.json", role: "entry", spec: {
            root: "main", elements: {
              main: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["status", "allocation", "practice", "tasks", "done", "plan"] },
              status: { type: "Text", props: { text: "今天从第一天练习开始" }, children: [] },
              allocation: { type: "Table", props: { columns: ["科目", "常规日", "模拟日"], rows: [["口语", "100分钟", "60分钟"], ["听力", "50分钟", "40分钟"], ["写作", "60分钟", "60分钟"], ["阅读", "30分钟", "60分钟"], ["复盘", "各科内", "20分钟"], ["合计", "240分钟", "240分钟"]] }, children: [] },
              practice: { type: "Text", props: { text: "先完成一次首录，再只改一处，换题练习。" }, children: [] },
              tasks: { type: "TaskList", props: { path: "day-1.md", section: null, title: "今天要做", showProgress: true }, children: [] },
              done: { type: "Button", props: { label: "今天做完了", variant: "primary" }, on: { press: { action: "say", params: { text: "今天做完了" } } }, children: [] },
              plan: { type: "PageLink", props: { label: "学习规划", path: "README.md", hint: null }, children: [] },
            },
          } });
          await call("chrona_ui_set", { affairId: affair.id, path: "card.ui.json", role: "card", spec: {
            root: "status", elements: { status: { type: "Text", props: { text: "今天的练习已经准备好" }, children: [] } },
          } });
          await call("chrona_schedule", { affairId: affair.id, mode: "remind", rule: { kind: "daily", time: "08:00" }, text: "开始今天的学习", label: "每日学习提醒" });
          await call("chrona_reply", { text: "已建好规划" });
        } else await call("chrona_reply", { text: "收到" });
      }
      const trigger = input.prompt.split("\n\nTrigger: message\n").at(-1) ?? input.prompt;
      const done = (input.lane === "foreground" ? reply(trigger) : Promise.resolve())
        .then(() => ({ outcome: "finished" as const, sessionId: null, error: null }))
        .catch(() => ({ outcome: "failed" as const, sessionId: null, error: "E2E provider failed" }));
      return { done, inject: reply, async abort() { controller.abort(); await done; } };
    },
  };
}
