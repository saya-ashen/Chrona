import { createConnection, type Socket } from "node:net";
import { RUN_LIMITS } from "@chrona/contracts/steward";

type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

/** The SDK control connection precedes chrona.serve. Observe transport without sending a business request. */
export function httpSocketReady(path: string, channel: { closedWithError: Promise<Error> }, timers: Timers) {
  return new Promise<void>((resolve, reject) => {
    let socket: Socket | undefined, retry: ReturnType<typeof setTimeout> | undefined, settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      if (retry) timers.clearTimeout(retry);
      socket?.destroy();
      if (error) reject(error); else resolve();
    };
    const connect = () => {
      socket = createConnection(path);
      socket.once("connect", () => finish());
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        if (error.code === "ENOENT" || error.code === "ECONNREFUSED") retry = timers.setTimeout(connect, 10);
        else finish(error);
      });
    };
    const timeout = timers.setTimeout(() => finish(new Error("Module HTTP start timeout")), RUN_LIMITS.jobTimeoutMs);
    void channel.closedWithError.then(finish);
    connect();
  });
}
