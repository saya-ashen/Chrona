#!/usr/bin/env bun
// TEST ONLY: stands in for `pi` and drives Chrona's agent endpoint the way the real extension does.
const base = process.env.CHRONA_AGENT_URL!, token = process.env.CHRONA_AGENT_TOKEN!, scenario = process.env.FAKE_PI_SCENARIO ?? "publish";
const call = async (path: string, body?: unknown) => (await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;
const log = (await import("node:fs")).appendFileSync;
const record = (line: string) => process.env.FAKE_PI_LOG && log(process.env.FAKE_PI_LOG, `${line}\n`);
record(`env:${Object.keys(process.env).filter(k => k.startsWith("CHRONA_") || k === "API_KEY" || k === "DATABASE_URL").sort().join(",")}`);
record(`args:${process.argv.slice(2).filter(a => a.startsWith("--")).join(" ")}`);
const catalog = await call("/catalog"); record(`catalog:${catalog.tools.map((t: any) => t.name).join(",")}`);
const context = (await call("/tools/chrona_get_context", {})).data; record(`inputs:${JSON.stringify(context.inputs.map((i: any) => i.text))}`);
const web = await call("/web/preflight", { tool: "web_search", input: { queries: ["backup tools comparison"], provider: "x" } }); record(`web:${web.allow}:${JSON.stringify(web.input)}`);
await call("/web/observed", { tool: "web_search", urls: ["https://example.org/backup"], titles: [] });
await call("/tools/chrona_save_progress", { summary: "Gathered sources" });
if (scenario === "ask" && context.inputs.length === 0) record(`ask:${JSON.stringify(await call("/tools/chrona_ask_user", { questions: [{ question: "When is it?", why: "Timeline decides scope" }] }))}`);
else record(`publish:${JSON.stringify(await call("/tools/chrona_publish_result", { title: "Backup comparison", summary: "Restic fits best.", body: "Restic vs Borg ...", sources: [{ title: "Example", url: "https://example.org/backup" }, { title: "Unseen", url: "https://example.net/unseen" }], handling: { mode: "result_page", rationale: "One-off research worth keeping" } }))}`);
record(`after:${JSON.stringify(await call("/tools/chrona_save_progress", { summary: "late" }))}`);
export {};
