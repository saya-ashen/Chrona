import { mock } from "bun:test";
import * as pi from "@chrona/pi";
import { piTranscript } from "../../../../../../pi/src/pi-transcript";
import type { ProviderAdapter } from "@chrona/contracts/steward";

// Keep the production SDK, runtime handler, application and transcript reader.
// Only the process/model backend is controlled; this fixture never spawns Pi.
let starts = 0;
mock.module("@chrona/pi", () => ({ ...pi, createPiProvider(): ProviderAdapter {
  return { name: "pi", supportsRunModel: true, transcript: piTranscript,
    async health() { return { available: true, sandboxed: false, error: null }; },
    start() {
      starts++;
      let finish!: (value: { outcome: "failed"; sessionId: null; error: string }) => void;
      return { done: new Promise(resolve => { finish = resolve; }), async inject() {},
        async abort() { finish({ outcome: "failed", sessionId: null, error: "Fixture aborted" }); },
        async native() { return { starts }; },
      };
    },
  };
} }));
await import("./runtime");
