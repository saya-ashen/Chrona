import { expect, test } from "bun:test";
import { assertModuleAvailable, isModulePaused, ModuleUnavailableError, PAUSED_MODULE_NAMES } from "./module-availability";
import { CallError } from "./module-call-error";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";

test("only retained Remind remains paused", () => {
  expect([...PAUSED_MODULE_NAMES]).toEqual(["remind"]);
});

test.each([...PAUSED_MODULE_NAMES])("%s is explicitly unavailable even without configured release resources", async name => {
  expect(isModulePaused(name)).toBe(true);
  expect(new ModuleUnavailableError(name)).toBeInstanceOf(CallError);
  expect(() => assertModuleAvailable(name)).toThrow("unavailable: paused");
  for (const hash of [undefined, "a".repeat(40), "b".repeat(64)]) {
    await expect(resolveExternalRelease({}, name, hash)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
    await expect(resolveBuiltinRelease({}, name, hash)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
  }
});

test.each(["mind", "web", "qq", "notify", "agent", "author", "events", "files", "memory-local", "mcp"])("%s remains admitted by the temporary policy", name => {
  expect(isModulePaused(name)).toBe(false);
  expect(() => assertModuleAvailable(name)).not.toThrow();
});
