import { expect, test } from "bun:test";
import { releaseSmokeEnvironment } from "../build/release-smoke";

test("release smoke uses isolated credentials and disables real providers", () => {
  const env = releaseSmokeEnvironment("/tmp/smoke/data", "/tmp/smoke/config", {
    API_KEY: "inherited-test-key",
    CHRONA_STEWARD_AGENT: "pi",
    CHRONA_QQ_APP_ID: "inherited-app",
    CHRONA_QQ_SECRET_FILE: "/must-not-read",
  });
  expect(env.API_KEY).toBeTruthy();
  expect(env.API_KEY).not.toBe("inherited-test-key");
  expect(env.CHRONA_STEWARD_AGENT).toBe("");
  expect(env.CHRONA_QQ_APP_ID).toBe("");
  expect(env.CHRONA_QQ_SECRET_FILE).toBe("");
  expect(env.DATABASE_URL).toBe("file:/tmp/smoke/data/chrona.db");
});
