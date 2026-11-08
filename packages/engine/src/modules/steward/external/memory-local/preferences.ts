import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type Preference = { id: string; text: string; topic: "general" | "ui"; origin: "said"; createdAt: string; lastUsedAt: null };
/** Preferences belong to the memory application; existing kernel records are not silently imported. */
export function preferences(dataDir: string) {
  const file = join(dataDir, "preferences.json");
  async function list(): Promise<Preference[]> {
    let text: string;
    try { text = await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const items: unknown = JSON.parse(text);
    if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== "string" || !item.id.startsWith("preference:") || typeof item.text !== "string" || item.text.length > 500 || !["general", "ui"].includes(item.topic) || item.origin !== "said" || !Number.isFinite(Date.parse(item.createdAt)) || item.lastUsedAt !== null)) throw new Error("Invalid memory preference journal");
    return items;
  }
  async function save(items: Preference[]) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${file}.next`, JSON.stringify(items), { mode: 0o600 }); await rename(`${file}.next`, file);
  }
  return {
    list,
    async remember(text: string, topic: "general" | "ui", at: string) {
      const items = await list(), prior = items.find(item => item.text === text && item.topic === topic);
      if (prior) return prior;
      const item: Preference = { id: `preference:${randomUUID()}`, text, topic, origin: "said", createdAt: at, lastUsedAt: null };
      items.unshift(item); await save(items); return item;
    },
    async forget(id: string) {
      const items = await list(), remaining = items.filter(item => item.id !== id);
      if (remaining.length === items.length) throw new Error("Preference not found");
      await save(remaining); return { forgotten: true };
    },
  };
}
