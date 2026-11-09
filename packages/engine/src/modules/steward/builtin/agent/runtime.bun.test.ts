import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleAgentInputs, moduleAgentOutputs } from "@chrona/contracts/steward";
import manifest from "./module.json";

const privateTools = ["start", "status", "inject", "abort", "release", "transcript"];
const publicTools = ["health", "complete", "completion", "context", "run", "get", "lookup", "stream", "write", "interrupt", "respond", "inspect", "placement", "locations", "cleanup", "projects"];
test("Agent manifest keeps legacy execution controls kernel-only and retains app contracts", () => {
  const parsed = moduleManifestSchema.parse(manifest);
  expect(parsed.tools.filter(tool => tool.visibility.includes("modules")).map(tool => tool.name).sort()).toEqual([...publicTools].sort());
  expect(Object.keys(moduleAgentInputs).sort()).toEqual(["complete", "completion", "health"]);
  expect(Object.keys(moduleAgentOutputs).sort()).toEqual(["complete", "completion", "health"]);
  for (const name of privateTools) {
    const tool = parsed.tools.find(tool => tool.name === name)!;
    expect(tool.visibility).toEqual(["kernel"]);
    expect(tool.parameters).toEqual({ type: "object", properties: { input: { type: "string", description: "Kernel-only encoded request" } }, required: ["input"] });
  }
  for (const name of ["health", "complete", "completion"]) expect(parsed.tools.find(tool => tool.name === name)!.visibility).toEqual(["kernel", "modules"]);
  expect(parsed.tools.find(tool => tool.name === "configure")!.visibility).toEqual(["owner"]);
  const complete = parsed.tools.find(tool => tool.name === "complete")!;
  expect(Object.keys(complete.parameters.properties)).toEqual(["command-key", "prompt", "system", "max-output-tokens", "input"]);
});

for (const [scenario, description] of [
  ["denial", "runtime denies modules all six legacy controls before any execution or callback"],
  ["artifact-denial", "checked runtime artifact independently denies modules kernel execution controls"],
  ["kernel", "kernel encoded calls retain start, control, confirmed release, transcript and completion"],
  ["context", "app context primitives retain admission, transcript and private write/interrupt control"],
  ["configure", "Agent configuration uses the routed live owner callback"],
  ["projects", "Agent projects routes a live call without configuring a model"],
  ["projects-artifact", "built Agent projects artifact routes the same bounded contract"],
  ["completion", "app health and structured completion retain model budget admission and settlement"],
]) test(description, async () => {
  const data = await mkdtemp("/tmp/chrona-agent-runtime-");
  try {
    const child = Bun.spawn([process.execPath, "run", join(import.meta.dir, "runtime.fixture.ts"), scenario], {
      env: { ...process.env, CHRONA_DATA: data, CHRONA_AGENT_MODEL_ENV: "{}" }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  } finally { await rm(data, { recursive: true, force: true }); }
});
