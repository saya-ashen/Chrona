type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class Drafts {
  constructor(public storage: StorageLike) {}
  read(id: string): any { const raw = this.storage.getItem('chat.draft.' + id); return raw ? JSON.parse(raw) : null; }
  edit(id: string, text: string) {
    const draft = { text, token: crypto.randomUUID() };
    this.storage.setItem('chat.draft.' + id, JSON.stringify(draft));
    return draft;
  }
  clear(id: string, token: string | null) {
    if (token && this.read(id)?.token === token) this.storage.removeItem('chat.draft.' + id);
  }
  value(id: string, serverText: string) { return this.read(id)?.text ?? serverText; }
}
export class DraftConflicts {
  constructor(public storage: StorageLike) {}
  read(id: string): { token: string; settings?: any } | null {
    const raw = this.storage.getItem('chat.conflict.' + id); return raw ? JSON.parse(raw) : null;
  }
  edit(id: string, proposal: { settings?: any }) {
    const conflict = { ...proposal, token: crypto.randomUUID() };
    this.storage.setItem('chat.conflict.' + id, JSON.stringify(conflict)); return conflict;
  }
  clear(id: string, token: string) {
    if (this.read(id)?.token === token) this.storage.removeItem('chat.conflict.' + id);
  }
}
export class Operations {
  constructor(public storage: StorageLike) {}
  read(id: string): any { const raw = this.storage.getItem('chat.operation.' + id); return raw ? JSON.parse(raw) : null; }
  begin(id: string, kind: string, input: any, draftToken: string | null) {
    const old = this.read(id);
    // A lost HTTP reply keeps the original operation. A new click never invents a replacement key.
    if (old) return old;
    const op = { id, key: crypto.randomUUID(), kind, input: JSON.stringify(input), draftToken };
    this.storage.setItem('chat.operation.' + id, JSON.stringify(op));
    return op;
  }
  settle(id: string, conversation: any, drafts: Drafts) {
    const op = this.read(id);
    if (!op) return;
    const receipt = conversation.operations.find((x: any) => x.key === op.key);
    if (!receipt || !['succeeded', 'rejected'].includes(receipt.status)) return;
    if (receipt.status === 'succeeded' && ['send', 'message'].includes(op.kind)) drafts.clear(id, op.draftToken);
    this.storage.removeItem('chat.operation.' + id);
  }
}
export async function uploadFiles(originId: string, files: any[], send: (args: any) => Promise<any>, onResult: (id: string, c: any) => void) {
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024) throw Error(file.name + ' 超过2MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const c = await send({ id: originId, name: file.name, mime: file.type, base64: btoa(binary) });
    onResult(originId, c);
  }
}
