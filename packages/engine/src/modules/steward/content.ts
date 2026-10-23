import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { moduleManifestSchema, relativePathSchema, saveFileSchema, toggleCheckboxSchema, panelEntrySchema, uiEventSchema, type FileNode } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { appendCsvRow, parsePanelBlocks, toggleCheckbox } from "@chrona/domain/steward/markdown";
import { checkUiSpec } from "@chrona/ui-catalog";
import { moduleSupervisor } from "./module-supervisor";
import { audit } from "./audit";
import type { ChatInput } from "./chat";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const locks = new Map<string, Promise<void>>();
async function locked<T>(key: string, action: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(done => { release = done; });
  locks.set(key, current); await previous;
  try { return await action(); }
  finally { release(); if (locks.get(key) === current) locks.delete(key); }
}
export async function contentArea(ports: StewardPorts, workspaceId: string, moduleId: string) {
  const module = await ports.db.module.findFirst({ where: { workspaceId, id: moduleId } });
  const version = module?.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } }) : null;
  if (!module || !moduleManifestSchema.safeParse(version?.manifest).data?.content) throw new StewardError("not_found", "Content area not found");
  const root = resolve(ports.dataDir, "platform", "content", module.id);
  let current = resolve(ports.dataDir);
  if (await realpath(current) !== current) throw new StewardError("forbidden", "Unsafe data directory");
  for (const part of ["platform", "content", module.id]) {
    current = join(current, part); await mkdir(current, { recursive: true });
    if ((await lstat(current)).isSymbolicLink() || await realpath(current) !== current) throw new StewardError("forbidden", "Unsafe content directory");
  }
  async function target(path: string, parents = false) {
    parseInput(relativePathSchema, path);
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) throw new StewardError("invalid", "Invalid content path");
    let value = root;
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      value = join(value, part);
      let info;
      try { info = await lstat(value); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (index === parts.length - 1) return value;
        if (!parents) throw error;
        await mkdir(value); info = await lstat(value);
      }
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) throw new StewardError("forbidden", "Unsafe content path");
    }
    return value;
  }
  async function raw(path: string) {
    const value = await target(path), handle = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new StewardError("forbidden", "Unsafe content file");
      return { bytes: await handle.readFile(), mime: Bun.file(value).type || "application/octet-stream", updatedAt: info.mtime.toISOString() };
    } finally { await handle.close(); }
  }
  async function write(path: string, bytes: Uint8Array, exclusive = false) {
    if (/\.(?:[cm]?[jt]sx?|sh|bash|zsh|fish|py|rb|pl|php|exe|dll|com|bat|cmd|ps1|vbs|msi|scr|jar|wasm|app|desktop)$/i.test(path) || (bytes[0] === 0x23 && bytes[1] === 0x21) || (bytes[0] === 0x4d && bytes[1] === 0x5a) || (bytes[0] === 0x7f && bytes[1] === 0x45)) throw new StewardError("invalid", "Executable content is not allowed");
    const handle = await open(await target(path, true), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (exclusive ? constants.O_EXCL : 0), 0o644);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new StewardError("forbidden", "Unsafe content file");
      await handle.truncate(0); await handle.writeFile(bytes);
    } finally { await handle.close(); }
  }
  return {
    directory: root, module,
    async snapshot() {
      const files = new Map<string, string>();
      for (const file of await this.list()) if (file.kind === "file") files.set(file.path, hash((await raw(file.path)).bytes));
      return files;
    },
    raw,
    upload: (path: string, bytes: Uint8Array) => locked(root, () => write(path, bytes, true)),
    async read(path: string) { const file = await raw(path); return { path, content: file.bytes.toString("utf8"), mime: file.mime, revision: hash(file.bytes), updatedAt: file.updatedAt }; },
    save: (path: string, content: string, baseRevision: string | null) => locked(root, async () => {
      let revision: string | null = null;
      try { revision = hash((await raw(path)).bytes); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (revision !== baseRevision) throw new StewardError("conflict", "Content changed since base revision");
      await write(path, Buffer.from(content));
      return { path, revision: hash(Buffer.from(content)) };
    }),
    intake: (files: { path: string; bytes: Uint8Array }[]) => locked(root, async () => { for (const file of files) await write(file.path, file.bytes); }),
    async list() {
      const files: FileNode[] = [];
      async function walk(prefix: string) {
        for (const entry of await readdir(prefix ? await target(prefix) : root, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const path = prefix ? `${prefix}/${entry.name}` : entry.name, info = await lstat(await target(path));
          files.push({ path, kind: info.isDirectory() ? "dir" : "file", size: info.size, updatedAt: info.mtime.toISOString() });
          if (info.isDirectory()) await walk(path);
        }
      }
      await walk(""); return files.sort((a, b) => a.path.localeCompare(b.path));
    },
  };
}
export async function deliverContentEdit(ports: StewardPorts, workspaceId: string, moduleId: string, paths: string[], by: "user" | "provider") {
  const module = await ports.db.module.findFirst({ where: { workspaceId, id: moduleId, status: "active" } });
  if (!module?.activeHash) return;
  for (let offset = 0; offset < paths.length; offset += 200) {
    await moduleSupervisor(ports).deliver(module.id, module.activeHash, { trigger: { kind: "content_edit", id: "content", firedAt: ports.now().toISOString(), paths: paths.slice(offset, offset + 200), by }, now: ports.now().toISOString(), params: {} });
  }
}

export function createContent(ports: StewardPorts, workspaceId: string, chat: (input: ChatInput) => Promise<unknown>) {
  const area = (id: string) => contentArea(ports, workspaceId, id);
  async function saved(id: string, path: string, content: string, revision: string | null) {
    const files = await area(id);
    await files.save(path, content, revision);
    await deliverContentEdit(ports, workspaceId, id, [path], "user");
    return files.read(path);
  }
  return {
    tree: async (id: string) => (await area(id)).list(),
    read: async (id: string, path: string) => (await area(id)).read(path),
    raw: async (id: string, path: string) => (await area(id)).raw(path),
    save: async (id: string, raw: unknown) => { const input = parseInput(saveFileSchema, raw); return saved(id, input.path, input.content, input.baseRevision); },
    async toggleCheckbox(id: string, raw: unknown) {
      const input = parseInput(toggleCheckboxSchema, raw), file = await (await area(id)).read(input.path);
      return saved(id, input.path, toggleCheckbox(file.content, input.line, input.checked), input.baseRevision);
    },
    async appendPanelEntry(id: string, raw: unknown) {
      const input = parseInput(panelEntrySchema, raw), files = await area(id);
      return locked(`${files.directory}:panel`, async () => {
        const panels = [];
        for (const node of await files.list()) {
          if (node.kind !== "file") continue;
          if (node.path.endsWith(".md")) panels.push(...parsePanelBlocks((await files.read(node.path)).content));
          if (node.path.endsWith(".ui.json")) {
            const spec = JSON.parse((await files.read(node.path)).content);
            if (checkUiSpec(spec).ok) for (const element of Object.values(spec.elements) as { type: string; props: unknown }[]) if (element.type === "Panel") panels.push(...parsePanelBlocks("```chrona-panel\n" + JSON.stringify(element.props) + "\n```"));
          }
        }
        const panel = panels.find(panel => panel.data === input.dataPath);
        if (!panel) throw new StewardError("invalid", "Panel declaration not found");
        let file = { content: "", revision: null as string | null };
        try { file = await files.read(input.dataPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        return saved(id, input.dataPath, appendCsvRow(file.content, panel.fields, input.values), file.revision);
      });
    },
    async upload(id: string, directory: string, name: string, bytes: Uint8Array) {
      if (bytes.length > 20 * 1024 * 1024) throw new StewardError("invalid", "Upload exceeds 20 MB");
      const clean = name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180);
      if (!clean) throw new StewardError("invalid", "Invalid upload name");
      const files = await area(id), path = directory ? `${directory}/${clean}` : clean;
      await files.upload(path, bytes);
      await deliverContentEdit(ports, workspaceId, id, [path], "user");
      return (await files.list()).find(file => file.path === path)!;
    },
    async uiEvent(id: string, raw: unknown, sessionId?: string) {
      const input = parseInput(uiEventSchema, raw); await area(id);
      if (input.kind === "feedback" && !input.text?.trim()) throw new StewardError("invalid", "Feedback requires text");
      if (sessionId && !await ports.db.session.findFirst({ where: { workspaceId, id: sessionId, source: "web", status: "active" } })) throw new StewardError("not_found", "Active web session not found");
      await audit(ports.db, { workspaceId, actor: "user", kind: "ui_event", subjectId: id, details: input });
      if (input.kind === "feedback") {
        const session = sessionId ? { id: sessionId } : await ports.db.session.findFirst({ where: { workspaceId, source: "web", status: "active" }, orderBy: { lastActivityAt: "desc" } });
        await chat({ workspaceId, channel: "in_app", ...(session ? { sessionId: session.id } : {}), text: `对页面「${input.path}」的意见：${input.text}` });
      }
      return { ok: true };
    },
  };
}

export async function filesContent(ports: StewardPorts, workspaceId: string) {
  const module = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name: "files" } } });
  if (!module) throw new StewardError("not_found", "Files content area not found");
  return contentArea(ports, workspaceId, module.id);
}
