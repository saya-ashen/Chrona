import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the OpenClaw client and device identity modules
vi.mock("@/modules/runtime/openclaw/client", () => ({
  OpenClawGatewayClient: vi.fn(),
}));

vi.mock("@/modules/runtime/openclaw/device-identity", () => ({
  loadOpenClawPersistedDeviceIdentity: vi.fn().mockResolvedValue(null),
}));

import {
  isOpenClawSuggestAvailable,
  _resetSuggestState,
} from "../openclaw-suggest";

describe("openclaw-suggest", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetSuggestState();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isOpenClawSuggestAvailable", () => {
    it("returns false when OPENCLAW_MODE is mock", () => {
      process.env.OPENCLAW_MODE = "mock";
      process.env.OPENCLAW_GATEWAY_URL = "ws://localhost:3001/gateway";
      process.env.OPENCLAW_AUTH_TOKEN = "test-token";
      expect(isOpenClawSuggestAvailable()).toBe(false);
    });

    it("returns false when no gateway URL", () => {
      delete process.env.OPENCLAW_MODE;
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_BASE_URL;
      process.env.OPENCLAW_AUTH_TOKEN = "test-token";
      expect(isOpenClawSuggestAvailable()).toBe(false);
    });

    it("returns false when no auth", () => {
      delete process.env.OPENCLAW_MODE;
      process.env.OPENCLAW_GATEWAY_URL = "ws://localhost:3001/gateway";
      delete process.env.OPENCLAW_AUTH_TOKEN;
      delete process.env.OPENCLAW_API_KEY;
      delete process.env.OPENCLAW_AUTH_PASSWORD;
      expect(isOpenClawSuggestAvailable()).toBe(false);
    });

    it("returns true when gateway URL and auth token are set", () => {
      delete process.env.OPENCLAW_MODE;
      process.env.OPENCLAW_GATEWAY_URL = "ws://localhost:3001/gateway";
      process.env.OPENCLAW_AUTH_TOKEN = "test-token";
      expect(isOpenClawSuggestAvailable()).toBe(true);
    });

    it("returns true with OPENCLAW_AUTH_PASSWORD", () => {
      delete process.env.OPENCLAW_MODE;
      process.env.OPENCLAW_GATEWAY_URL = "ws://localhost:3001/gateway";
      delete process.env.OPENCLAW_AUTH_TOKEN;
      process.env.OPENCLAW_AUTH_PASSWORD = "test-pass";
      expect(isOpenClawSuggestAvailable()).toBe(true);
    });
  });
});
