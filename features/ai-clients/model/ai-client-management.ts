import { aiClientRegistry } from "../runtime/client-registry";
import { testAiClientAvailability } from "../../../packages/engine/src/modules/ai/providers";
import { createAiClient } from "./create-ai-client";
import { deleteAiClient } from "./delete-ai-client";
import { listAiClients } from "./list-ai-clients";
import { updateAiClient } from "./update-ai-client";
import { updateAiClientBindings } from "./update-ai-client-bindings";

export class AiClientManagement {
  list() {
    return listAiClients();
  }

  async create(input: Parameters<typeof createAiClient>[0]) {
    const client = await createAiClient(input);
    await aiClientRegistry.refresh();
    return client;
  }

  async update(input: { clientId: string; data: Parameters<typeof updateAiClient>[1] }) {
    const client = await updateAiClient(input.clientId, input.data);
    await aiClientRegistry.refresh();
    return client;
  }

  async delete(input: { clientId: string }) {
    await deleteAiClient(input.clientId);
    await aiClientRegistry.refresh();
    return { success: true };
  }

  test(input: Parameters<typeof testAiClientAvailability>[0]) {
    return testAiClientAvailability(input);
  }

  async updateBindings(input: Parameters<typeof updateAiClientBindings>[0]) {
    const features = await updateAiClientBindings(input);
    await aiClientRegistry.refresh();
    return features;
  }
}

export const aiClientManagement = new AiClientManagement();
