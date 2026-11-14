export type MindUpdate = { id: string; revision: number; status: string; goal: string; waitReason?: string; nextStep?: string; artifactRefs: string[]; updatedAt: string };

/** Optional live projection. It never writes Chat messages, observations or Agent commands. */
export async function readMindUpdates(call: (target: {moduleId: string; tool: string}, args: Record<string, unknown>) => Promise<unknown>, moduleId: string | undefined, conversationId: string, source: {epoch: string; scopeRevision: number}): Promise<MindUpdate[]> {
  if (!moduleId) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let phase = 'call';
  try {
    const reply = await Promise.race([call({moduleId, tool: 'updates'}, {conversationId,...source}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { phase = 'timeout'; reject(Error('Mind updates timeout')); }, 500); })]);
    phase = 'envelope';
    if (!reply || typeof reply !== 'object' || !('json' in reply) || typeof reply.json !== 'string' || Buffer.byteLength(reply.json) > 32768) throw Error('Invalid Mind updates envelope');
    phase = 'parse';
    const value = JSON.parse(reply.json);
    phase = 'items';
    if (!Array.isArray(value.items) || value.items.length > 8 || value.items.some((item: MindUpdate) => !item || typeof item.id !== 'string' || typeof item.goal !== 'string' || typeof item.status !== 'string' || (item.waitReason !== undefined && typeof item.waitReason !== 'string') || (item.nextStep !== undefined && typeof item.nextStep !== 'string') || !Array.isArray(item.artifactRefs) || item.artifactRefs.some(ref => typeof ref !== 'string'))) throw Error('Invalid Mind updates');
    return value.items;
  } catch (error) {
    console.error(JSON.stringify({component:'chat',event:'mind_updates_unavailable',moduleId,conversationId,phase,error:error instanceof Error ? error.name : typeof error}));
    return [];
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
