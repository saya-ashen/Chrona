import { createHash, createPrivateKey, createPublicKey, sign as signBuffer } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenClawDeviceIdentity } from "@/modules/openclaw/types";

type PersistedDeviceRecord = {
  deviceId?: string;
  publicKeyPem?: string;
  privateKeyPem?: string;
};

type PersistedDeviceAuthRecord = {
  tokens?: {
    operator?: {
      token?: string;
    };
  };
};

function base64UrlEncode(input: Buffer) {
  return input
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function readPublicKeyBase64Url(publicKeyPem: string) {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" }) as JsonWebKey & {
    x?: string;
  };
  if (typeof jwk.x !== "string" || jwk.x.length === 0) {
    throw new Error("OpenClaw device public key is missing JWK x coordinate");
  }

  return jwk.x;
}

function deriveDeviceId(publicKey: string) {
  return createHash("sha256").update(base64UrlDecode(publicKey)).digest("hex");
}

export async function loadOpenClawPersistedDeviceIdentity(options?: {
  identityDir?: string;
}): Promise<OpenClawDeviceIdentity | null> {
  const identityDir = options?.identityDir ?? join(homedir(), ".openclaw", "identity");

  try {
    const device = await readJsonFile<PersistedDeviceRecord>(join(identityDir, "device.json"));
    if (
      typeof device.deviceId !== "string" ||
      typeof device.publicKeyPem !== "string" ||
      typeof device.privateKeyPem !== "string"
    ) {
      throw new Error("OpenClaw persisted device identity is incomplete");
    }

    const publicKey = readPublicKeyBase64Url(device.publicKeyPem);
    const derivedDeviceId = deriveDeviceId(publicKey);
    if (derivedDeviceId !== device.deviceId) {
      throw new Error("OpenClaw persisted device id does not match the public key");
    }

    let deviceToken: string | undefined;
    try {
      const auth = await readJsonFile<PersistedDeviceAuthRecord>(
        join(identityDir, "device-auth.json"),
      );
      if (typeof auth.tokens?.operator?.token === "string" && auth.tokens.operator.token.length > 0) {
        deviceToken = auth.tokens.operator.token;
      }
    } catch {
      deviceToken = undefined;
    }

    const privateKey = createPrivateKey(device.privateKeyPem);

    return {
      deviceId: device.deviceId,
      publicKey,
      deviceToken,
      platform: process.platform,
      sign: async (payload: string) =>
        base64UrlEncode(signBuffer(null, Buffer.from(payload, "utf8"), privateKey)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
