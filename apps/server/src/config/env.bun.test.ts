import { afterEach, describe, expect, it } from "bun:test";

import { assertSafeBind, readEnv, resetEnvCacheForTests } from "./env";

function resetEnv() {
  delete process.env.HOST;
  delete process.env.API_KEY;
  delete process.env.CHRONA_UNSAFE_PUBLIC_BIND;
  resetEnvCacheForTests();
}

describe("server environment safety", () => {
  afterEach(() => {
    resetEnv();
  });

  it("defaults to local-only binding", () => {
    resetEnv();
    expect(readEnv().HOST).toBe("127.0.0.1");
  });

  it("refuses public binding without API_KEY unless explicitly overridden", () => {
    expect(() => assertSafeBind({
      ...readEnv(),
      HOST: "0.0.0.0",
      API_KEY: undefined,
      CHRONA_UNSAFE_PUBLIC_BIND: undefined,
    })).toThrow("Refusing to start Chrona");

    expect(() => assertSafeBind({
      ...readEnv(),
      HOST: "0.0.0.0",
      API_KEY: undefined,
      CHRONA_UNSAFE_PUBLIC_BIND: "1",
    })).not.toThrow();
  });
});
