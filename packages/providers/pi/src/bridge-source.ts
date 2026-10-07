/** Loaded only by Chrona's Pi subprocess. No installation or user-config mutation. */
export const PI_BRIDGE_NAMESPACE = "chrona.pi.bridge";
export const PI_BRIDGE_VERSION = 1;
export const PI_BRIDGE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * Uses Node's public child-process JSON IPC channel. This is deliberately
 * separate from Pi RPC's stdin/stdout LF JSONL protocol.
 */
export const PI_BRIDGE_SOURCE = String.raw`
const NAMESPACE = "chrona.pi.bridge";
const VERSION = 1;
const MAX_MESSAGE_BYTES = ${PI_BRIDGE_MAX_MESSAGE_BYTES};

export default async function (pi) {
  let config;
  let initialized = false;
  let sessionStarted = false;
  let sessionModel = null;
  let readySent = false;
  let closed = false;
  const pending = new Map();

  const safeSize = (value) => {
    try { return Buffer.byteLength(JSON.stringify(value)); }
    catch { return MAX_MESSAGE_BYTES + 1; }
  };
  const failPending = () => {
    for (const call of pending.values()) call.reject(new Error("Chrona bridge disconnected"));
    pending.clear();
  };
  const send = (message) => new Promise((resolve, reject) => {
    const envelope = { namespace: NAMESPACE, version: VERSION, message };
    if (closed || !process.connected || typeof process.send !== "function") {
      reject(new Error("Chrona bridge disconnected"));
      return;
    }
    if (safeSize(envelope) > MAX_MESSAGE_BYTES) {
      reject(new Error("Chrona bridge message too large"));
      return;
    }
    try {
      // A false return is backpressure, not delivery failure. The callback only
      // confirms Node accepted the write; a result reply remains the authority.
      process.send(envelope, (error) => error ? reject(new Error("Chrona bridge disconnected")) : resolve());
    } catch {
      reject(new Error("Chrona bridge disconnected"));
    }
  });
  const sendReady = () => {
    if (!initialized || !sessionStarted || readySent || closed) return;
    const names = config.tools.map((tool) => tool.name);
    const active = config.isolated ? names : [...new Set([...pi.getActiveTools(), ...names])];
    pi.setActiveTools(active);
    readySent = true;
    void send({ type: "ready", model: sessionModel }).catch(failPending);
  };
  const validConfig = (message) => message
    && typeof message === "object"
    && !Array.isArray(message)
    && Array.isArray(message.tools)
    && typeof message.instructions === "string"
    && typeof message.isolated === "boolean"
    && message.tools.every((tool) => tool
      && typeof tool === "object"
      && !Array.isArray(tool)
      && typeof tool.name === "string"
      && tool.name.length > 0
      && tool.inputSchema
      && typeof tool.inputSchema === "object"
      && !Array.isArray(tool.inputSchema));
  const receive = (envelope) => {
    if (!envelope || typeof envelope !== "object" || envelope.namespace !== NAMESPACE || envelope.version !== VERSION) return;
    if (safeSize(envelope) > MAX_MESSAGE_BYTES) { failPending(); return; }
    const message = envelope.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) { failPending(); return; }
    if (message.type === "init") {
      if (config || !validConfig(message)) { failPending(); return; }
      try {
        // Validate the complete catalog before registering anything. A malformed
        // partial init must neither expose tools nor acknowledge readiness.
        for (const tool of message.tools) {
          pi.registerTool({
            name: tool.name,
            label: tool.name,
            description: typeof tool.description === "string" ? tool.description : tool.name,
            parameters: tool.inputSchema,
            async execute(id, args, signal) {
              if (signal?.aborted) throw new Error("Cancelled");
              let abort;
              try {
                return await new Promise((resolve, reject) => {
                  const call = { resolve, reject };
                  abort = () => { if (pending.get(id) === call) { pending.delete(id); reject(new Error("Cancelled")); } };
                  pending.set(id, call);
                  signal?.addEventListener("abort", abort, { once: true });
                  void send({ type: "call", id, name: tool.name, input: args }).catch(() => abort());
                });
              } finally { if (abort) signal?.removeEventListener("abort", abort); }
            },
          });
        }
      } catch { failPending(); return; }
      config = message;
      initialized = true;
      // Application acknowledgement establishes that the full catalog was
      // registered; IPC write callbacks alone do not establish this boundary.
      void send({ type: "initialized" }).then(sendReady).catch(failPending);
      return;
    }
    if (message.type !== "result" || typeof message.id !== "string") return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error("Chrona bridge request failed"));
    else call.resolve(message.result);
  };

  process.on("message", receive);
  process.on("disconnect", () => { closed = true; failPending(); });
  pi.on("session_start", (_event, ctx) => {
    // Pi may start the session before the parent IPC init arrives. Latch only
    // bounded model metadata, then reconcile once the catalog is initialized.
    sessionStarted = true;
    sessionModel = ctx.model ? ctx.model.provider + "/" + ctx.model.id : null;
    sendReady();
  });
  pi.on("before_agent_start", (event) => {
    if (!config) return;
    // Keep the user's full runtime prompt in execution mode. Isolated runs do
    // not discover user/project extensions, skills, prompts or context files.
    return { systemPrompt: event.systemPrompt + "\n\n" + config.instructions };
  });
  pi.on("session_shutdown", () => { failPending(); });
}
`;
