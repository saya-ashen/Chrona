import type { Directory } from "./registry";

export function testDirectory(name = "qq", id = `${name}-id`, hash = "h"): Directory {
  return {
    modules: [{ id, name, status: "active", activeHash: hash }],
    tools: [{ target: `${name}.deliver`, moduleId: id, hash, contractHash: "c".repeat(64), inputSchema: {
      type: "object", properties: Object.fromEntries(["key", "title", "body", "format", "link", "recipient", "approval", "scoped"].map(key => [key, { type: key === "scoped" ? "boolean" : "string" }])), required: ["key", "title", "body"],
    }, outputSchema: { type: "object", properties: { outcome: { const: "accepted" }, receiptRef: { type: "string" } }, required: ["outcome", "receiptRef"] } }],
  };
}
