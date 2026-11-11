import { createHash } from "node:crypto";
import { providerText } from "@chrona/domain/steward/provider";
import { EXECUTION_EVENT_LIMITS, executionEventSchema, executionJsonBytes, type ExecutionEvent, type ExecutionPayload, type ProviderRunInput } from "@chrona/contracts/steward";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

/** A single drain promise and bounded normalized queue; raw RPC never enters storage. */
export class PiDetail {
  private seq = 0;
  private queue: ExecutionEvent[] = [];
  private bytes = 0;
  private draining: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lost: { from: number; through: number } | null = null;
  private failure = false;
  private final: ExecutionPayload | null = null;
  private messageId = 0;
  constructor(private input: ProviderRunInput, private secrets: string[]) {}
  private text(value: unknown, limit = 20_000) {
    const text = providerText(value, this.secrets, limit, true);
    return Buffer.byteLength(text) > limit ? Buffer.from(text).subarray(0, limit).toString("utf8") : text;
  }
  private event(payload: ExecutionPayload): ExecutionEvent {
    return { ...this.input.execution!, seq: ++this.seq, at: new Date().toISOString(), payload };
  }
  private gap(seq: number) {
    this.lost = { from: Math.min(this.lost?.from ?? seq, seq), through: Math.max(this.lost?.through ?? seq, seq) };
    this.failure = true;
  }
  emit(payload: ExecutionPayload) {
    if (!this.input.detail || !this.input.execution) return;
    const event = this.event(payload), bytes = executionJsonBytes(event);
    if (!executionEventSchema.safeParse(event).success || this.queue.length >= EXECUTION_EVENT_LIMITS.bufferEvents || this.bytes + bytes > EXECUTION_EVENT_LIMITS.bufferBytes) { this.gap(event.seq); return; }
    this.queue.push(event); this.bytes += bytes;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, EXECUTION_EVENT_LIMITS.flushMs);
  }
  receive(event: RecordValue) {
    this.receiveMessage(event);
    this.receiveTool(event);
  }
  private receiveMessage(event: RecordValue) {
    const message = object(event.message), delta = object(event.assistantMessageEvent);
    if (event.type === "message_start" && ["user", "assistant"].includes(String(message.role))) {
      this.messageId++;
      this.emit({ type: "message", messageId: `message:${this.messageId}`, role: message.role as "user" | "assistant", text: "", complete: false });
    }
    if (event.type === "message_update" && delta.type === "text_delta") {
      if (typeof delta.delta === "string" && Buffer.byteLength(delta.delta) > 20_000) this.gap(++this.seq);
      this.emit({ type: "text_delta", messageId: `message:${this.messageId}`, delta: this.text(delta.delta) });
    }
    if (event.type === "message_end" && ["user", "assistant"].includes(String(message.role))) {
      const raw = this.messageText(message.content);
      const text = this.text(raw);
      if (Buffer.byteLength(raw) > 20_000) this.gap(++this.seq);
      const payload: ExecutionPayload = { type: "message", messageId: `message:${this.messageId}`, role: message.role as "user" | "assistant", text, complete: true };
      if (message.role === "assistant") this.final = payload;
      this.emit(payload);
    }
  }
  private messageText(content: unknown): string {
    return Array.isArray(content) ? content.map(object).filter(part => part.type === "text").map(part => typeof part.text === "string" ? part.text : "").join("\n") : typeof content === "string" ? content : "";
  }
  private toolId(value: unknown) {
    if (typeof value !== "string" || !value) return "";
    // Provider IDs are opaque; composite IDs must still correlate start and end.
    return this.text(value, 128) === value && /^[\w:.-]+$/.test(value) ? value : `tool:${createHash("sha256").update(value).digest("hex")}`;
  }
  private receiveTool(event: RecordValue) {
    if (event.type === "tool_execution_start") {
      const tool = this.text(event.toolName, 100), toolCallId = this.toolId(event.toolCallId);
      if (tool && /^[\w:.-]+$/.test(toolCallId)) this.emit({ type: "tool_started", toolCallId, tool, display: {} });
    }
    if (event.type === "tool_execution_end") {
      const tool = this.text(event.toolName, 100), toolCallId = this.toolId(event.toolCallId);
      if (tool && /^[\w:.-]+$/.test(toolCallId)) {
        const originalBytes = event.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(event.result));
        this.emit({ type: "tool_finished", toolCallId, tool, isError: event.isError === true, summary: event.isError ? "Tool failed" : "Tool completed", truncated: originalBytes > 0, originalBytes });
      }
    }
  }
  private flush(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.queue.length) {
        const event = this.queue[0]!;
        try { await this.input.detail!.append(event); }
        catch { this.gap(event.seq); }
        this.queue.shift(); this.bytes -= executionJsonBytes(event);
      }
    })().finally(() => { this.draining = null; });
    return this.draining;
  }
  async close(status: "completed" | "failed") {
    clearTimeout(this.timer);
    await this.flush();
    // Reserved snapshot/control recovery must still run after detail loss or saturation.
    const append = async (payload: ExecutionPayload) => {
      try { await this.input.detail!.append(this.event(payload)); }
      catch { this.failure = true; }
    };
    if (this.lost) await append({ type: "gap", ...this.lost, reason: "backpressure" });
    if (this.final) await append(this.final);
    await append({ type: "state", status, cancelRequested: false, stopConfirmed: true });
    if (this.failure) throw new Error("Execution detail is incomplete; recover the final snapshot");
  }
}

