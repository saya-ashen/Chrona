export function resolveSqliteAdapterUrl(url: string, runtime: "bun" | "node") {
  if (runtime === "bun") {
    return url;
  }

  return url.startsWith("file:") ? url.slice("file:".length) : url;
}
