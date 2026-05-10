import { createAiClient } from "../modules/commands/create-ai-client";
import { deleteAiClient } from "../modules/commands/delete-ai-client";
import { updateAiClient } from "../modules/commands/update-ai-client";
import { updateAiClientBindings } from "../modules/commands/update-ai-client-bindings";
import { testAiClientAvailability } from "../modules/ai/providers";
import { listAiClients } from "../modules/queries/list-ai-clients";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export type AiClientListItem = Awaited<ReturnType<typeof listAiClients>>[number];

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
        return await createAiClient(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create AI client");
      }
    },
    async update(input: { clientId: string; data: Parameters<typeof updateAiClient>[1] }) {
      try {
        return await updateAiClient(input.clientId, input.data);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to update AI client");
      }
    },
    async delete(input: { clientId: string }) {
      try {
        await deleteAiClient(input.clientId);
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
        return await updateAiClientBindings(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to update feature bindings");
      }
    },
  };
}
