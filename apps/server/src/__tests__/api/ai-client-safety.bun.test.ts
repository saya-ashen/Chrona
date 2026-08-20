import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

function app() {
	const server = new Hono();
	server.route("/api", createApiRouter(createChronaEngine()));
	return server;
}

async function createClient(input: Record<string, unknown>) {
	return app().request("http://local/api/ai/clients", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
}

describe("AI client safety", () => {
	const previousNodeEnv = process.env.NODE_ENV;
	const previousDebugFlag = process.env.CHRONA_ENABLE_DEBUG_PROVIDER;

	beforeEach(async () => {
		await resetTestDb();
		await seedWorkspace("AI client safety");
		process.env.NODE_ENV = "test";
		delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
	});

	afterEach(() => {
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
		if (previousDebugFlag === undefined)
			delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
		else process.env.CHRONA_ENABLE_DEBUG_PROVIDER = previousDebugFlag;
	});

	it("[AISET-004] exposes the debug runtime only while the debug provider flag is enabled", async () => {
		const disabledResponse = await app().request(
			"http://local/api/runtime/providers",
		);
		expect(disabledResponse.status).toBe(200);
		expect(
			((await disabledResponse.json()) as { providers: Array<{ key: string }> })
				.providers,
		).not.toContainEqual(expect.objectContaining({ key: "debug" }));

		process.env.CHRONA_ENABLE_DEBUG_PROVIDER = "true";
		const enabledResponse = await app().request(
			"http://local/api/runtime/providers",
		);
		expect(enabledResponse.status).toBe(200);
		expect(
			((await enabledResponse.json()) as { providers: Array<{ key: string }> })
				.providers,
		).toContainEqual(expect.objectContaining({ key: "debug" }));
	});

	it("[AISET-011] deleting a bound default client promotes a fallback and removes bindings", async () => {
		const defaultResponse = await createClient({
			name: "Default client",
			type: "hermes",
			isDefault: true,
		});
		const defaultClient = (await defaultResponse.json()) as {
			client: { id: string };
		};
		const fallbackResponse = await createClient({
			name: "Fallback client",
			type: "llm",
		});
		expect(fallbackResponse.status).toBe(201);

		const bindResponse = await app().request(
			`http://local/api/ai/clients/${defaultClient.client.id}/bindings`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ features: ["chat"] }),
			},
		);
		expect(bindResponse.status).toBe(200);

		const deleteResponse = await app().request(
			`http://local/api/ai/clients/${defaultClient.client.id}`,
			{ method: "DELETE" },
		);
		expect(deleteResponse.status).toBe(200);

		const listResponse = await app().request("http://local/api/ai/clients");
		const list = (await listResponse.json()) as {
			clients: Array<{ id: string; name: string; isDefault: boolean }>;
		};
		expect(list.clients).toEqual([
			expect.objectContaining({ name: "Fallback client", isDefault: true }),
		]);
		expect(
			await db.aiFeatureBinding.count({
				where: { clientId: defaultClient.client.id },
			}),
		).toBe(0);
	});
});
