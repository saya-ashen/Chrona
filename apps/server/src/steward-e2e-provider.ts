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
          await call("m_remind_create", { rule: JSON.stringify({ kind: "daily", time: "08:00" }), text: "开始今天的学习", label: "每日学习提醒" });
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
