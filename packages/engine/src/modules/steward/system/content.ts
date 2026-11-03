import { z } from "zod";
import * as outputs from "../system-outputs";
import { CallError, type SystemModule } from "../module-calls";
import { CONTENT_READ_MAX_BYTES, readContentRef } from "../content";
import { tool, text, json } from "./shared";

/** `content` (v2-29): files in apps' content areas by reference, for modules that declare content.read in `uses` (approved with them). */
export const content: SystemModule = {
  name: "content", description: "内容：按引用读取应用内容区里的文件（如生成的图片），在清单 uses 中声明 content.read 并经批准后可用。", unrecorded: ["read"],
  tools: [tool("read", `A file in an app's content area (or a chat attachment) by ref <module>/<path>, base64-encoded with its size and SHA-256; at most ${CONTENT_READ_MAX_BYTES} bytes. For images and documents too large for a tool result.`, { ref: text("<module>/<path>, e.g. image-generation/job-1.png") }, ["ref"], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.contentReadOutput) })],
  async handle({ ports, workspaceId }, name, args) {
    if (name !== "read") throw new CallError("not_found", `content.${name} not found`);
    const { bytes, ...file } = await readContentRef(ports, workspaceId, String(args.ref));
    return json({ ...file, bytes: bytes.byteLength, base64: Buffer.from(bytes).toString("base64") });
  } };
