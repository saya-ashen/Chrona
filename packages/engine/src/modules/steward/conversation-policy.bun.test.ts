import { expect, test } from "bun:test";
import { conversationOptions as web } from "./builtin/web/conversation";
import { conversationOptions as mcp } from "./builtin/mcp/conversation";
import { conversationOptions as qq } from "./external/qq/conversation";

for (const [name, policy] of [["web", web], ["mcp", mcp], ["qq", qq]] as const) {
  test.each([
    [120, 40000, false, true], [120, 10000, false, false], [10, 40000, false, false],
    [10, 120000, false, true], [120, 120000, true, false],
  ] as const)(`${name} owns conversation rotation: idle %i, tokens %i, busy %p => %p`, async (idleMinutes, contextTokens, busy, rotate) => {
    const at = new Date("2026-11-07T04:00:00Z"), session = { id: "s", title: "手动标题", lastActivityAt: new Date(at.getTime() - idleMinutes * 60000).toISOString(), contextTokens, busy };
    const options = await policy(async (target, args) => {
      expect(target).toBe("chat.conversation-state"); expect(args).toEqual({ key: `${name}:dm` });
      return { now: at.toISOString(), limits: { idleMinutes: 60, minContextTokens: 30000, maxContextTokens: 100000 }, session };
    }, `${name}:dm`, "新的事项");
    expect(options.rotation !== undefined).toBe(rotate);
    if (rotate) expect(JSON.parse(options.rotation!)).toEqual({ sessionId: "s", lastActivityAt: session.lastActivityAt });
    else expect(options.title).toBeUndefined();
  });
  test(`${name} proposes a bounded Unicode title and keeps work guidance in module data`, async () => {
    const options = await policy(async () => ({ now: "2026-11-07T04:00:00Z", limits: { idleMinutes: 60, minContextTokens: 30000, maxContextTokens: 100000 }, session: null }), `${name}:new`, ` ${"🦊".repeat(41)} \n更多`);
    expect(options.title).toBe(`${"🦊".repeat(40)}…`);
    expect(options.guidance).toContain("personal steward"); expect(options.rotation).toBeUndefined();
  });
}
