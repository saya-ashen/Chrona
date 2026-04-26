/**
 * GET  /api/ai/clients — list all AI clients
 * POST /api/ai/clients — create a new AI client
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export async function GET() {
  const clients = await db.aiClient.findMany({
    include: { bindings: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      config: c.config,
      isDefault: c.isDefault,
      enabled: c.enabled,
      bindings: c.bindings.map((b) => b.feature),
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, type, config, isDefault } = body;

    if (!name || !type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }

    if (type !== "openclaw" && type !== "llm") {
      return NextResponse.json({ error: "type must be 'openclaw' or 'llm'" }, { status: 400 });
    }

    // If this is set as default, unset other defaults
    if (isDefault) {
      await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const client = await db.aiClient.create({
      data: {
        id: randomUUID().replace(/-/g, "").slice(0, 25),
        name,
        type,
        config: config ?? {},
        isDefault: isDefault ?? false,
        enabled: true,
      },
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    console.error("Error creating AI client:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
