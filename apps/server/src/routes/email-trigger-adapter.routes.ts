import { createHmac, timingSafeEqual } from "node:crypto";

import { emailTriggerDeliveryBodySchema } from "@chrona/contracts/api";
import type { ChronaEngine } from "@chrona/engine";
import { Hono } from "hono";

import { readEnv } from "../config/env";
import { error, internalServerError, json, toHttpError } from "../lib/http";

const MAX_PER_MINUTE = 60;
const deliveries = new Map<string, { minute: number; count: number }>();

function safeEqual(left: string, right: string) {
  const provided = Buffer.from(left);
  const expected = Buffer.from(right);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function validSignature(secret: string, timestamp: Date, rawBody: string, provided: string) {
  const expected = createHmac("sha256", secret).update(`${timestamp.toISOString()}.${rawBody}`).digest("hex");
  return safeEqual(provided, expected);
}

function allowDelivery(source: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const current = deliveries.get(source);
  if (!current || current.minute !== minute) {
    deliveries.set(source, { minute, count: 1 });
    return true;
  }
  if (current.count >= MAX_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

export function createEmailTriggerAdapterRoutes(engine: ChronaEngine) {
  return new Hono().post("/integrations/email/events", async (c) => {
    const configuredSecret = readEnv().CHRONA_EMAIL_TRIGGER_SECRET;
    const providedSecret = c.req.header("x-chrona-email-secret") ?? "";
    if (!configuredSecret || !safeEqual(providedSecret, configuredSecret)) return error(c, "Invalid email adapter credential", 401);
    const rawBody = await c.req.text();
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { return error(c, "Invalid email delivery payload", 400); }
    const validation = emailTriggerDeliveryBodySchema.safeParse(parsed);
    if (!validation.success) return error(c, "Invalid email delivery payload", 400);
    const delivery = validation.data;
    if (Math.abs(Date.now() - delivery.timestamp.getTime()) > 5 * 60_000) return error(c, "Expired email delivery", 401);
    if (!validSignature(configuredSecret, delivery.timestamp, rawBody, c.req.header("x-chrona-email-signature") ?? "")) return error(c, "Invalid email delivery signature", 401);
    const source = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!allowDelivery(source)) return error(c, "Email adapter rate limit exceeded", 429);
    if (delivery.text.length > 50_000) return error(c, "Email delivery payload too large", 413);
    try {
      const activated = await engine.triggers.activateEmail(delivery);
      return json(c, { accepted: true, activated });
    } catch (cause) {
      const mapped = toHttpError(cause);
      if (mapped) return error(c, mapped.message, mapped.status);
      return internalServerError(c, "POST /api/integrations/email/events", cause, "Email delivery failed");
    }
  });
}
