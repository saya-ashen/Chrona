/**
 * PUT /api/ai/clients/[clientId]/bindings — set feature bindings for a client
 *
 * Body: { features: ["suggest", "decompose", ...] }
 *
 * This replaces all existing bindings. Features bound to this client
 * are removed from other clients automatically (unique constraint).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

const VALID_FEATURES = ["suggest", "decompose", "conflicts", "timeslots", "chat"] as const;

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { clientId } = await params;
  const body = await request.json();
  const { features } = body as { features?: string[] };

  if (!Array.isArray(features)) {
    return NextResponse.json({ error: "features must be an array" }, { status: 400 });
  }

  const validFeatures = features.filter((f): f is typeof VALID_FEATURES[number] =>
    (VALID_FEATURES as readonly string[]).includes(f),
  );

  const client = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Delete old bindings for these features (from any client)
  if (validFeatures.length > 0) {
    await db.aiFeatureBinding.deleteMany({
      where: { feature: { in: validFeatures } },
    });
  }

  // Delete old bindings for this client (features being removed)
  await db.aiFeatureBinding.deleteMany({
    where: { clientId, feature: { notIn: validFeatures } },
  });

  // Create new bindings
  for (const feature of validFeatures) {
    await db.aiFeatureBinding.create({
      data: {
        id: randomUUID().replace(/-/g, "").slice(0, 25),
        feature,
        clientId,
      },
    });
  }

  return NextResponse.json({
    bindings: validFeatures,
  });
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { clientId } = await params;
  const bindings = await db.aiFeatureBinding.findMany({
    where: { clientId },
  });
  return NextResponse.json({
    features: bindings.map((b) => b.feature),
  });
}
