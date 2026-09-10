/** Local deterministic CLI fixture; never contacts a model or reads user config. */
export const FAKE_PI_SOURCE = String.raw`#!/usr/bin/env node
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
if (process.argv.includes("--version")) { console.log("0.85.0"); process.exit(0); }
const args = process.argv.slice(2);
const file = args[args.indexOf("--session") + 1];
let sessionId;
try { sessionId = JSON.parse(fs.readFileSync(file, "utf8")).id; }
catch { sessionId = randomUUID(); fs.writeFileSync(file, JSON.stringify({ id: sessionId, turns: 0 })); }
const output = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const bridgeOutput = new Socket({ fd: 4, readable: false, writable: true });
const send = (event) => bridgeOutput.write(JSON.stringify(event) + "\n");
let config;
let pendingPrompt;
let scenario;
function read(stream, receive) {
  const decoder = new StringDecoder("utf8"); let text = "";
  stream.on("data", (chunk) => { text += decoder.write(chunk); let i; while ((i = text.indexOf("\n")) >= 0) { const item = text.slice(0, i); text = text.slice(i + 1); receive(JSON.parse(item)); } });
}
function answer(text) {
  output({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
  output({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 10, output: 4 } } });
  output({ type: "agent_end", messages: [] });
  setTimeout(() => output({ type: "agent_settled" }), 20);
}
read(new Socket({ fd: 3, readable: true, writable: false }), (message) => {
  if (message.type === "init") { config = message; send({ type: "ready" }); if (pendingPrompt) pendingPrompt(); }
  if (message.type === "result") {
    if (scenario === "duplicate" && !message.error) { send({ type: "call", id: "call-2", name: config.tools[0].name, input: { result: { ok: true } } }); return; }
    output({ type: "tool_execution_end", toolName: config.tools[0].name, toolCallId: "call-1", isError: Boolean(message.error) });
    if (!message.error) answer("result submitted");
  }
});
read(process.stdin, (request) => {
  const response = (data = {}) => output({ id: request.id, type: "response", command: request.type, success: true, data });
  if (request.type === "get_state") {
    const ready = () => setTimeout(() => response({ sessionId, sessionFile: file, model: { provider: "fixture", id: "model" } }), 10);
    if (config) ready(); else pendingPrompt = ready;
  } else if (request.type === "prompt") {
    response();
    const state = JSON.parse(fs.readFileSync(file, "utf8")); state.turns++; fs.writeFileSync(file, JSON.stringify(state));
    scenario = request.message.split("scenario:")[1]?.trim();
    if (scenario === "hang") return;
    if (scenario === "eof") { process.stdout.end(); return; }
    if (scenario === "exit") { process.exit(0); }
    if (scenario === "extension-error") { output({ type: "extension_error", error: "PRIVATE_SECRET" }); return; }
    if (scenario === "confirm" || scenario === "input") { output({ type: "extension_ui_request", id: "approval-1", method: scenario, title: "Allow fixture action?" }); return; }
    if (scenario === "fail") { output({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "PRIVATE_SECRET" } }); output({ type: "agent_settled" }); return; }
    if (scenario === "retry") { output({ type: "agent_end", willRetry: true }); setTimeout(() => answer("after retry"), 100); return; }
    if (config.tools.length && scenario !== "missing") { send({ type: "call", id: "call-1", name: config.tools[0].name, input: { result: { ok: true } } }); return; }
    answer(scenario === "health" ? "CHRONA_PI_READY" : "turn " + state.turns + " 中文\u2028line");
  } else if (request.type === "extension_ui_response") { if (request.confirmed) answer("approved"); else answer("denied"); }
  else if (request.type === "set_auto_retry" && config.instructions === "startup-eof") { process.stdout.end(); }
  else if (request.type === "set_auto_retry" && config.instructions === "startup-hang") { /* no response */ }
  else response();
});
`;
