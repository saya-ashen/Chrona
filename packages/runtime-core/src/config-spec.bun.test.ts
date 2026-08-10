import { describe, expect, it } from "bun:test";
import {
  getValueAtPath,
  readMissingRequiredPaths,
  readRequiredFieldLabel,
  setValueAtPath,
  validateTaskConfigAgainstSpec,
  type RuntimeInput,
  type RuntimeTaskConfigSpec,
} from "./index";

const configSpec: RuntimeTaskConfigSpec = {
  runtime: "test-runtime",
  version: "1",
  fields: [
    { key: "title", path: "title", kind: "text", label: "Title", required: true, constraints: { minLength: 3 } },
    { key: "retries", path: "advanced.retries", kind: "number", label: "Retries", defaultValue: 2, constraints: { min: 0, max: 5 } },
    { key: "enabled", path: "enabled", kind: "boolean", label: "Enabled", defaultValue: false },
    { key: "labels", path: "labels", kind: "json", label: "Labels" },
  ],
  runnability: { requiredPaths: ["title", "advanced.retries"] },
};

describe("runtime-core configuration contract", () => {
  it("normalizes public task input, applies defaults, and does not mutate the caller input", () => {
    const input: RuntimeInput = { title: "  Ship it  ", advanced: { retries: "4" }, labels: '{"region":"us"}' };

    expect(validateTaskConfigAgainstSpec(configSpec, input)).toEqual({
      title: "Ship it",
      advanced: { retries: 4 },
      enabled: false,
      labels: { region: "us" },
    });
    expect(input).toEqual({ title: "  Ship it  ", advanced: { retries: "4" }, labels: '{"region":"us"}' });
  });

  it("rejects invalid public config at the field boundary", () => {
    expect(() => validateTaskConfigAgainstSpec(configSpec, { title: "no", advanced: { retries: 8 } })).toThrow("Title");
    expect(() => validateTaskConfigAgainstSpec(configSpec, { title: "valid", advanced: { retries: "NaN" } })).toThrow("Retries");
    expect(() => validateTaskConfigAgainstSpec(configSpec, [])).toThrow("runtimeInput must be an object");
  });

  it("uses dot-separated paths for nested input and reports missing required paths with labels", () => {
    const input: RuntimeInput = {};
    setValueAtPath(input, "advanced.retries", 3);
    expect(getValueAtPath(input, "advanced.retries")).toBe(3);
    expect(readMissingRequiredPaths(configSpec, input)).toEqual(["title"]);
    expect(readRequiredFieldLabel(configSpec, "title")).toBe("Title");
  });
});
