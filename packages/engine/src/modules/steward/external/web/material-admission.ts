import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identity = z.object({ moduleId: z.string().min(1), hash }).strict();
const target = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]*$/), moduleId: z.string().min(1).nullable(), expectedActiveHash: hash.nullable() }).strict();
const request = z.object({ appsModuleId: z.string().min(1).max(128), materialId: z.string().regex(/^apps:[a-f0-9-]{36}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict();
const material = z.object({ id: z.string(), name: z.string(), fingerprint: z.string(), state: z.literal('prepared'), submitter: identity, target });
const reply = z.object({ admissionId: z.string().min(1).max(128), requestKey: z.string().min(1).max(200), submitter: identity, targets: z.array(target).length(1) }).strict();
type Call = (tool: string, args?: Record<string, unknown>, options?: {key?: string}) => Promise<any>;
const fail = (message: string, code = 'conflict'): never => { throw Object.assign(new Error(message), {code}); };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Called ONLY by the existing authenticated Web HTTP owner entry, never an app tool.
 * Reads the real apps journal, admits one exact prepared material, never submits or approves.
 * Persist the stable invocation key before the idempotent kernel admission call.
 */
export function createMaterialAdmission(dataDir: string, call: Call, overview: (moduleId: string) => Promise<any>) {
 let lock: Promise<unknown> = Promise.resolve();
 async function execute(input: unknown) {
  const parsed = request.safeParse(input);
  if (!parsed.success) return fail('精确材料准入参数无效；必须明确确认，不接受浏览器提供的身份或目标', 'invalid');
  const args = parsed.data;
  const modules = await call('modules.list');
  const apps = modules.items.find((x: any) => x.id === args.appsModuleId && x.name === 'apps' && x.status === 'active' && x.activeHash);
  if (!apps) return fail('应用中心已变化，请刷新页面');
  const raw = await overview(apps.id);
  const data = typeof raw?.json === 'string' ? JSON.parse(raw.json) : raw;
  const checked = material.safeParse(data.materials?.find((x: any) => x.id === args.materialId));
  if (!checked.success) return fail('材料不存在或不再待提交；已发送的候选只能核对原回执');
  const m = checked.data;
  if (m.name !== m.target.name || m.fingerprint !== args.fingerprint || m.submitter.moduleId !== apps.id || m.submitter.hash !== apps.activeHash) return fail('材料指纹或真实提交方已变化；不能继承旧准入');
  const current = modules.items.find((x: any) => x.name === m.name);
  if (m.target.moduleId ? current?.id !== m.target.moduleId || current?.activeHash !== m.target.expectedActiveHash : !!current || m.target.expectedActiveHash !== null) return fail('目标基线已变化；禁止覆盖');
  const draft = {submitter: m.submitter, targets: [m.target]};
  const binding = JSON.stringify({fingerprint: m.fingerprint, ...draft});
  const dir = join(dataDir, 'material-admissions');
  const file = join(dir, sha(`${apps.id}/${m.id}`) + '.json');
  const save = async (record: unknown) => {
   await fs.mkdir(dir, {recursive: true});
   const temp = file + '.' + randomUUID();
   await fs.writeFile(temp, JSON.stringify(record), {mode: 0o600});
   await fs.rename(temp, file);
  };
  let record: {binding: string; key: string; admission?: z.infer<typeof reply>};
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; record = {binding, key: 'web-material:' + randomUUID()}; await save(record); }
  if (record.binding !== binding) return fail('原材料绑定已变化；保留原 key，需人工核对');
  if (!record.admission) {
   // Unknown admission replies may be reconciled by repeating this idempotent call
   // with the exact persisted key. A candidate submit is never repeated here.
   const result = reply.parse(await call('modules.admit', draft, {key: record.key}));
   if (JSON.stringify(result.submitter) !== JSON.stringify(draft.submitter) || JSON.stringify(result.targets) !== JSON.stringify(draft.targets)) return fail('准入返回与精确材料不匹配');
   record.admission = result;
   await save(record);
  }
  return reply.parse(record.admission);
 }
 return (input: unknown) => {
  const next = lock.then(() => execute(input));
  lock = next.catch(() => {});
  return next;
 };
}
