import { z } from "zod";

// Ordinary entry-owned projection of the public fixed-candidate receipt contract.
// Keep the complete receipt: selectors or assistant text alone cannot establish targets.
const id = z.string().min(1).max(128);
const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const name = z.string().regex(/^[a-z][a-z0-9-]*$/).max(64);
const member = z.object({ name, moduleId: id, hash, versionId: id, expectedActiveHash: hash.nullable(), materialDigest: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["building", "testing", "pending_review", "approved", "rejected"]), selected: z.boolean() }).strict();
export const deliveryReceiptSchema = z.object({
  receiptId: id, admissionId: id, requestKey: z.string().trim().min(1).max(120), submitter: z.object({ moduleId: id, hash }).strict(),
  state: z.enum(["submitted", "pending_approval", "approved", "rejected"]), approvalId: id.nullable(), members: z.array(member).min(1).max(4),
}).strict().refine(receipt => new Set(receipt.members.map(item => item.moduleId)).size === receipt.members.length && new Set(receipt.members.map(item => item.name)).size === receipt.members.length);
const pageSchema = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(200), href: z.string().max(1000) }).strict();
const targetSchema = z.object({ name, moduleId: id, hash, activation: z.enum(["unknown", "active", "different", "inactive"]), health: z.enum(["unknown", "observed", "issue"]), pages: z.array(pageSchema).max(20), pagesCheck: z.enum(["unknown", "current"]) }).strict();
const deliverySchema = z.object({ receipt: deliveryReceiptSchema, receiptCheck: z.enum(["current", "unknown"]), checkedAt: z.string().datetime().optional(), targets: z.array(targetSchema).min(1).max(4), browser: z.literal("unknown") }).strict();
export type ApplicationDelivery = z.infer<typeof deliverySchema>;
export type DeliveryPage = { module: string; moduleId: string; hash: string; id: string; title: string };
export type DeliveryPages = () => Promise<DeliveryPage[]>;
type PageIdentity = Omit<DeliveryPage, "hash"> & { hash?: string };
/** Read full private records: the navigation list intentionally omits the version hash. */
export async function readDeliveryPages(registry: { list(): Promise<Omit<DeliveryPage, "hash">[]>; get(module: string, id: string): Promise<PageIdentity | null> }): Promise<DeliveryPage[]> {
  const listed = await registry.list();
  if (listed.length > 1000) throw new Error("Delivery page inventory exceeds its bound");
  const pages: DeliveryPage[] = [];
  for (const item of listed) {
    // A page can disappear or become stale between list and get; it supplies no proof.
    let page: PageIdentity | null;
    try { page = await registry.get(item.module, item.id); } catch { continue; }
    if (page?.hash && page.module === item.module && page.moduleId === item.moduleId && page.id === item.id) {
      pages.push({ module: page.module, moduleId: page.moduleId, hash: page.hash, id: page.id, title: page.title });
    }
  }
  return pages;
}
type Call = (target: string, args?: Record<string, unknown>) => Promise<unknown>;
type TranscriptItem = { at: string; kind: string; text?: string; tool?: string; error?: boolean };
const receiptTools: Record<string, string> = { m_author_submit: "author.submit", m_author_receipt: "author.receipt", m_modules_submit: "modules.submit", m_modules_candidate_check: "modules.candidate-check" };
export function validApplicationDelivery(value: unknown) {
  const parsed = z.array(deliverySchema).max(4).safeParse(value);
  return parsed.success && parsed.data.every(delivery => delivery.targets.length === delivery.receipt.members.length && delivery.targets.every((target, index) => {
    const member = delivery.receipt.members[index]!;
    return target.name === member.name && target.moduleId === member.moduleId && target.hash === member.hash
      && target.pages.every(page => page.href === `/p/${encodeURIComponent(target.name)}/${encodeURIComponent(page.id)}`);
  }));
}
const targetsFor = (receipt: ApplicationDelivery["receipt"]): ApplicationDelivery["targets"] => receipt.members.map(item => ({ name: item.name, moduleId: item.moduleId, hash: item.hash, activation: "unknown", health: "unknown", pages: [], pagesCheck: "unknown" }));
const identity = (receipt: ApplicationDelivery["receipt"]) => JSON.stringify([receipt.receiptId, receipt.admissionId, receipt.requestKey, receipt.submitter, receipt.members.map(({ status: _status, selected: _selected, ...item }) => item)]);

/** agent.stream transcript has Pi toolResult JSON in text; detail events contain no results.
 * The current context bridge wraps output in {result}. Truncated/redacted JSON is not proof.
 */
type ReceiptSource = { applicationDelivery?: ApplicationDelivery[]; at: string; baseline: TranscriptItem[]; runRequest?: { tools: string[] } };
const successfulResultSchema = z.object({ kind: z.literal("result"), error: z.literal(false), tool: z.string().min(1), text: z.string().min(1).max(30_000) });
function resultReceipt(input: ReceiptSource, item: TranscriptItem, baseline: Set<string>, before?: string) {
  const result = successfulResultSchema.safeParse(item);
  if (!result.success) return;
  const target = receiptTools[result.data.tool];
  if (!target || !input.runRequest?.tools.includes(target) || baseline.has(JSON.stringify(item))) return;
  const at = Date.parse(item.at), start = Date.parse(input.at), end = before === undefined ? Number.MAX_VALUE : Date.parse(before);
  if (![at, start, end].every(Number.isFinite) || at < start || at >= end) return;
  try { return z.object({ result: deliveryReceiptSchema }).strict().parse(JSON.parse(result.data.text)).result; } catch { return; }
}
export function captureApplicationDelivery(input: ReceiptSource, transcript: TranscriptItem[], before?: string) {
  const baseline = new Set(input.baseline.map(item => JSON.stringify(item)));
  for (const item of transcript) {
    const receipt = resultReceipt(input, item, baseline, before);
    if (!receipt) continue;
    const deliveries = input.applicationDelivery ??= [];
    const prior = deliveries.find(delivery => delivery.receipt.receiptId === receipt.receiptId);
    if (prior) { if (identity(prior.receipt) === identity(receipt)) prior.receipt = receipt; }
    else if (deliveries.length < 4) deliveries.push({ receipt, receiptCheck: "unknown", targets: targetsFor(receipt), browser: "unknown" });
  }
}

// A health observation is neither a functional probe nor browser acceptance.
const healthSchema = z.object({ module: name, moduleId: id, activeHash: hash.nullable(), configuredStatus: z.string(), runtime: z.object({ state: z.string() }), open: z.boolean(), truncated: z.boolean() });
const healthPageSchema = z.object({ items: z.array(healthSchema).max(50), nextCursor: z.string().nullable() });
const localPagesSchema = z.array(z.object({ module: name, moduleId: id, hash, id: z.string().min(1).max(200), title: z.string().min(1).max(200) })).max(1000);
async function readHealth(call: Call) {
  const rows: z.infer<typeof healthSchema>[] = [];
  let cursor: string | undefined;
  // Match the existing bounded public health pages; missing a target stays unknown.
  for (let page = 0; page < 4; page++) {
    const next = healthPageSchema.parse(await call("modules.health", cursor ? { cursor } : {}));
    rows.push(...next.items);
    if (!next.nextCursor || next.nextCursor === cursor) break;
    cursor = next.nextCursor;
  }
  return rows;
}
async function receiptCheck(call: Call, delivery: ApplicationDelivery) {
  delivery.receiptCheck = "unknown";
  try {
    const receipt = deliveryReceiptSchema.parse(await call("modules.candidate-check", { receiptId: delivery.receipt.receiptId }));
    if (identity(receipt) !== identity(delivery.receipt)) return;
    delivery.receipt = receipt; delivery.receiptCheck = "current";
  } catch { /* Unavailable, denied or malformed exact checks remain unknown. */ }
}
function observeTarget(target: ApplicationDelivery["targets"][number], health: z.infer<typeof healthSchema>[], knownPages?: DeliveryPage[]) {
  const rows = health.filter(item => item.moduleId === target.moduleId && item.module === target.name);
  if (rows.length !== 1) return;
  const current = rows[0]!;
  target.activation = current.activeHash === null ? "inactive" : current.activeHash !== target.hash ? "different" : current.configuredStatus === "active" ? "active" : "inactive";
  if (target.activation !== "active") return;
  if (current.open || ["backoff", "unavailable", "paused"].includes(current.runtime.state)) target.health = "issue";
  else if (!current.truncated && ["running", "idle"].includes(current.runtime.state)) target.health = "observed";
  if (knownPages === undefined) return;
  target.pages = knownPages.filter(page => page.moduleId === target.moduleId && page.module === target.name && page.hash === target.hash).slice(0, 20).map(page => ({ id: page.id, title: page.title, href: `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}` }));
  if (target.pages.length) target.pagesCheck = "current";
}
/** Terminal reconciliation is application read policy; it never calls Agent or submits material.
 * Web injects its existing local registry reader (list + get); public web.pages is caller-owned
 * and cannot prove another application's hash. Other entry apps leave page proof unknown.
 */
export async function reconcileApplicationDelivery(call: Call, deliveries: ApplicationDelivery[], at: string, pages?: DeliveryPages) {
  let health: Awaited<ReturnType<typeof readHealth>> = [], knownPages: DeliveryPage[] | undefined;
  try { health = await readHealth(call); } catch { /* No inventory observation. */ }
  if (pages) try { knownPages = localPagesSchema.parse(await pages()); } catch { /* No page observation. */ }
  for (const delivery of deliveries) {
    await receiptCheck(call, delivery);
    delivery.checkedAt = at;
    delivery.targets = targetsFor(delivery.receipt);
    for (const target of delivery.targets) observeTarget(target, health, knownPages);
  }
}
