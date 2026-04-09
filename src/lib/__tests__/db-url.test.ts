import { describe, expect, it } from "vitest";

import { resolveSqliteAdapterUrl } from "@/lib/db-url";

describe("resolveSqliteAdapterUrl", () => {
  it("keeps file URLs for the Bun adapter", () => {
    expect(resolveSqliteAdapterUrl("file:./prisma/dev.db", "bun")).toBe(
      "file:./prisma/dev.db",
    );
  });

  it("converts file URLs into filesystem paths for the Node adapter", () => {
    expect(resolveSqliteAdapterUrl("file:./prisma/dev.db", "node")).toBe("./prisma/dev.db");
    expect(resolveSqliteAdapterUrl("./prisma/dev.db", "node")).toBe("./prisma/dev.db");
  });
});
