/**
 * GET    /api/ai/clients/[clientId] — get client details
 * PATCH  /api/ai/clients/[clientId] — update client
 * DELETE /api/ai/clients/[clientId] — delete client
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { clientId } = await params;
  const client = await db.aiClient.findUnique({
    where: { id: clientId },
    include: { bindings: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: client.id,
    name: client.name,
    type: client.type,
    config: client.config,
    isDefault: client.isDefault,
    enabled: client.enabled,
    bindings: client.bindings.map((b) => b.feature),
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { clientId } = await params;
  const body = await request.json();
  const { name, config, isDefault, enabled } = body;

  const existing = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // If setting as default, unset others
  if (isDefault === true) {
    await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const updated = await db.aiClient.update({
    where: { id: clientId },
    data: {
      ...(name !== undefined && { name }),
      ...(config !== undefined && { config }),
      ...(isDefault !== undefined && { isDefault }),
      ...(enabled !== undefined && { enabled }),
    },
  });

  return NextResponse.json({ client: updated });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { clientId } = await params;
  try {
    await db.aiClient.delete({ where: { id: clientId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
}
