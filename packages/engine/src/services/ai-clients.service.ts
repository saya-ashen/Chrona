import { createAiClient } from "../modules/ai/management/create-ai-client";
import { deleteAiClient } from "../modules/ai/management/delete-ai-client";
import { updateAiClient } from "../modules/ai/management/update-ai-client";
import { updateAiClientBindings } from "../modules/ai/management/update-ai-client-bindings";
import { testAiClientAvailability } from "../modules/ai/providers";
import { listAiClients } from "../modules/ai/management/list-ai-clients";
import { refreshAiClientRegistry } from "../modules/ai/runtime/client-registry";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

type AiClientListItem = Awaited<ReturnType<typeof listAiClients>>[number];

export function createAiClientsService() {
  return {
    async list(): Promise<AiClientListItem[]> {
      try {
        return await listAiClients();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to list AI clients");
      }
    },
    async create(input: Parameters<typeof createAiClient>[0]) {
      try {
        const client = await createAiClient(input);
        await refreshAiClientRegistry();
        return client;
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create AI client");
      }
    },
    async update(input: { clientId: string; data: Parameters<typeof updateAiClient>[1] }) {
      try {
        const client = await updateAiClient(input.clientId, input.data);
        await refreshAiClientRegistry();
        return client;
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to update AI client");
      }
    },
    async delete(input: { clientId: string }) {
      try {
        await deleteAiClient(input.clientId);
        await refreshAiClientRegistry();
        return { success: true };
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to delete AI client");
      }
    },
    async test(input: Parameters<typeof testAiClientAvailability>[0]) {
      return await testAiClientAvailability(input);
    },
    async updateBindings(input: Parameters<typeof updateAiClientBindings>[0]) {
      try {
        const features = await updateAiClientBindings(input);
        await refreshAiClientRegistry();
        return features;
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to update feature bindings");
      }
    },
  };
}
