import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { PassThrough } from "node:stream";

/** Windows extra stdio slots are runtime/CRT specific. Use an OS named pipe
 * instead; only the command's stdin/out/err are inherited by the helper.
 * The random pipe name is a capability within the trusted-local threat model.
 * No task is created until the helper connects. Owner death then closes the
 * connection in the kernel, including when JS cannot run an exit hook. */
export function spawnWindowsGuardian(helper: string, command: string, args: readonly string[], options: SpawnOptions,
  pipe = `\\\\.\\pipe\\chrona-process-${randomUUID()}`) {
  const control = new PassThrough(), status = new PassThrough();
  let socket: Socket | undefined;
  const server = createServer({ allowHalfOpen: true }, connection => {
    if (socket) { connection.destroy(); return; }
    socket = connection;
    server.close();
    // Keep the duplex pipe open after a cancel byte so exit evidence can return.
    control.pipe(connection, { end: false });
    connection.pipe(status);
    connection.once("end", () => connection.end());
    connection.on("error", error => status.destroy(error));
    connection.on("close", () => status.destroy());
  });
  server.on("error", error => status.destroy(error));
  server.listen(pipe);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(helper, ["--pipe", pipe, "--", command, ...args], {
      ...options, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
  } catch (error) {
    server.close(); control.destroy(); status.destroy();
    throw error;
  }
  const statusFinished = new Promise<void>(resolve => {
    status.once("end", resolve);
    status.once("close", resolve);
  });
  const dispose = () => { server.close(); socket?.destroy(); control.destroy(); status.destroy(); };
  child.once("error", dispose);
  return { child, control, status, statusFinished, dispose };
}
