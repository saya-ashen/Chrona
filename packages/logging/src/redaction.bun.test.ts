import { expect, test } from "bun:test";
import { redactSensitiveValue } from "./redaction";

test("redaction bounds self-referencing and mutually referencing Error causes", () => {
  const first = new Error("token=private-token");
  first.cause = first;
  expect(redactSensitiveValue(first)).toMatchObject({ message: "credential=[Redacted]", cause: "[Circular]" });
  const second = new Error("second", { cause: first });
  first.cause = second;
  expect(redactSensitiveValue({ error: first })).toMatchObject({ error: { cause: { message: "second", cause: "[Circular]" } } });
  const parent: { error?: Error } = {};
  parent.error = new Error("nested", { cause: parent });
  expect(redactSensitiveValue(parent)).toMatchObject({ error: { cause: "[Circular]" } });
});
