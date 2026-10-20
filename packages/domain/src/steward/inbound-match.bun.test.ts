import { expect, test } from "bun:test";
import { inboundMatches } from "./inbound-match";

test.each([
  [{}, "a@shop.example", "Receipt", true],
  [{ from: "*@SHOP.example" }, "a@shop.example", "Receipt", true],
  [{ from: "*@shop.example" }, "a@shop.example.evil", "Receipt", false],
  [{ from: "a+b@example.com" }, "a+b@example.com", "Receipt", true],
  [{ from: "a+b@example.com" }, "ab@example.com", "Receipt", false],
  [{ from: "a**b" }, "a\nzzb", "Receipt", true],
  [{ from: "" }, "someone", "Receipt", false],
  [{ from: "sender" }, "sender\n", "Receipt", false],
  [{ subject: "RECEIPT" }, "a", "Your receipt today", true],
  [{ subject: "receipt", from: "b" }, "a", "receipt", false],
  [{ subject: "invoice" }, "a", "receipt", false],
] as const)("inbound match %j / %s / %s → %s", (match, from, subject, expected) => {
  expect(inboundMatches(match, { from, subject })).toBe(expected);
});

test("many wildcards against a long hostile sender stay fast", () => {
  const started = performance.now();
  expect(inboundMatches({ from: `${"*a".repeat(100)}*b` }, { from: "a".repeat(500), subject: "" })).toBe(false);
  expect(performance.now() - started).toBeLessThan(100);
});
