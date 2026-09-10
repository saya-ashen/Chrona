/** Loaded only by Chrona's Pi subprocess. No installation or user-config mutation. */
export const PI_BRIDGE_SOURCE = String.raw`
import { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";

export default async function (pi) {
  // Extra stdio descriptors are IPC pipes/sockets, not files. fs.ReadStream
  // performs blocking thread-pool reads and can prevent Node from exiting while
  // the parent keeps fd3 open. Socket uses cancellable event-loop I/O instead.
  const input = new Socket({ fd: 3, readable: true, writable: false });
  const output = new Socket({ fd: 4, readable: false, writable: true });
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let initialize;
  const initial = new Promise((resolve) => { initialize = resolve; });
  const pending = new Map();
  const send = (value) => output.write(JSON.stringify(value) + "\n");
  input.on("data", (chunk) => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) throw new Error("Chrona bridge frame too large");
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.type === "init") initialize(message);
      if (message.type === "result") {
        const call = pending.get(message.id);
        if (!call) continue;
        pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error));
        else call.resolve(message.result);
      }
    }
  });
  input.on("end", () => {
    for (const call of pending.values()) call.reject(new Error("Chrona bridge disconnected"));
    pending.clear();
  });
  const config = await initial;
  for (const tool of config.tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema,
      async execute(id, args, signal) {
        if (signal?.aborted) throw new Error("Cancelled");
        let abort;
        try {
          return await new Promise((resolve, reject) => {
            abort = () => { pending.delete(id); reject(new Error("Cancelled")); };
            pending.set(id, { resolve, reject });
            signal?.addEventListener("abort", abort, { once: true });
            send({ type: "call", id, name: tool.name, input: args });
          });
        } finally {
          if (abort) signal?.removeEventListener("abort", abort);
        }
      },
    });
  }
  pi.on("session_start", (_event, ctx) => {
    const names = config.tools.map((tool) => tool.name);
    const active = config.isolated ? names : [...new Set([...pi.getActiveTools(), ...names])];
    pi.setActiveTools(active);
    send({ type: "ready", model: ctx.model ? ctx.model.provider + "/" + ctx.model.id : null });
  });
  pi.on("before_agent_start", (event) => {
    // Keep the user's full runtime prompt in execution mode. Isolated runs do
    // not discover user/project extensions, skills, prompts or context files.
    return { systemPrompt: event.systemPrompt + "\n\n" + config.instructions };
  });
  pi.on("session_shutdown", () => {
    for (const call of pending.values()) call.reject(new Error("Pi session closed"));
    pending.clear();
    input.destroy();
    output.end();
  });
}
`;
