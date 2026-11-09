import { expect, test } from "bun:test";
import { transcriptRedactor } from "@chrona/logging/redaction";

test("transcripts redact complete credentials before applying the display limit", () => {
  const redact = transcriptRedactor();
  expect(redact(`sk-${"a".repeat(5000)}`, 12)).toBe("[Redacted]");
  expect(redact(`Bearer ${"b".repeat(5000)}`, 30)).toBe("Bearer [Redacted]");
  expect(redact("token=credential-value", 100)).toBe("credential=[Redacted]");
});

test("transcripts replace literal environment secrets captured by the factory", () => {
  const key = "CHRONA_TRANSCRIPT_TEST_SECRET";
  const previous = process.env[key];
  try {
    const value = "literal.+[credential]$value";
    process.env[key] = value;
    const redact = transcriptRedactor();
    delete process.env[key];
    expect(redact(`before ${value} between ${value} after`, 100)).toBe("before [redacted] between [redacted] after");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

for (const prefix of ["xoxa", "xoxb", "xoxp"]) {
  test(`transcripts redact ${prefix} Slack tokens`, () => {
    expect(transcriptRedactor()(`${prefix}-${"A".repeat(50)}`, 100)).toBe("[redacted]");
  });
}

test("transcripts preserve plain text and the existing clipping marker", () => {
  const redact = transcriptRedactor();
  expect(redact("普通输出", 4)).toBe("普通输出");
  expect(redact("普通输出abc", 4)).toBe("普通输出…（已截断）");
  expect(redact("x".repeat(500), 1000)).toBe("x".repeat(500));
});
