import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOpenClawPersistedDeviceIdentity } from "@/modules/runtime/openclaw/device-identity";

function base64UrlToBuffer(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    }),
  );
});

describe("loadOpenClawPersistedDeviceIdentity", () => {
  it("loads the persisted device identity and operator device token", async () => {
    const identityDir = await mkdtemp(join(tmpdir(), "openclaw-identity-"));
    tempDirs.push(identityDir);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const deviceId = createHash("sha256").update(base64UrlToBuffer(publicJwk.x!)).digest("hex");

    await writeFile(
      join(identityDir, "device.json"),
      JSON.stringify(
        {
          version: 1,
          deviceId,
          publicKeyPem: publicPem,
          privateKeyPem: privatePem,
          createdAtMs: 1737264000000,
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(identityDir, "device-auth.json"),
      JSON.stringify(
        {
          version: 1,
          deviceId,
          tokens: {
            operator: {
              token: "device-token-123",
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              updatedAtMs: 1737264000000,
            },
          },
        },
        null,
        2,
      ),
    );

    const identity = await loadOpenClawPersistedDeviceIdentity({ identityDir });

    expect(identity).toMatchObject({
      deviceId,
      publicKey: publicJwk.x,
      deviceToken: "device-token-123",
      platform: process.platform,
    });
    await expect(identity?.sign("payload")).resolves.toEqual(expect.any(String));
  });
});
