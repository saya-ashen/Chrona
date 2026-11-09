type Preferences = { provider: string | null; autoRecall: boolean; autoRetain: boolean };
type Store = { read(): Promise<Preferences>; update(patch: unknown): Promise<Preferences> };
const fields = new Map<PropertyKey, string>([["provider", "provider"], ["auto-recall", "autoRecall"], ["auto-retain", "autoRetain"]]);

/** Keep form values scalar; the private store revalidates every patch before persisting. */
export async function uiSettings(store: Store, args: unknown) {
  if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null)) throw Object.assign(new Error("Expected a settings object"), { code: "invalid" });
  const patch: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(args)) {
    const field = fields.get(key);
    if (!field) throw Object.assign(new Error("Unknown preference tool argument"), { code: "invalid" });
    patch[field] = (args as Record<PropertyKey, unknown>)[key];
  }
  if (patch.provider === "") patch.provider = null;
  const saved = Reflect.ownKeys(patch).length ? await store.update(patch) : await store.read();
  return { ...saved, provider: saved.provider ?? "" };
}
