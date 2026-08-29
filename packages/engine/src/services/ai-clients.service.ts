import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { aiClientManagement } from "../modules/ai";

type AiClientListItem = Awaited<ReturnType<typeof aiClientManagement.list>>[number];

export function createAiClientsService() {
  return {
    async list(): Promise<AiClientListItem[]> {
      try {
        return await aiClientManagement.list();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to list AI clients");
      }
    },
    async create(input: Parameters<typeof aiClientManagement.create>[0]) {
      try {
        return await aiClientManagement.create(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create AI client");
      }
    },
    async update(input: Parameters<typeof aiClientManagement.update>[0]) {
      try {
        return await aiClientManagement.update(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to update AI client");
      }
    },
    async delete(input: { clientId: string }) {
      try {
        return await aiClientManagement.delete(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Failed to delete AI client");
      }
    },
    async test(input: Parameters<typeof aiClientManagement.test>[0]) {
      return await aiClientManagement.test(input);
    },
    async testExisting(input: Parameters<typeof aiClientManagement.testExisting>[0]) {
      try {
        return await aiClientManagement.testExisting(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND,
          "Failed to test AI client",
        );
      }
    },
    async updateBindings(input: Parameters<typeof aiClientManagement.updateBindings>[0]) {
      try {
        return await aiClientManagement.updateBindings(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to update feature bindings");
      }
    },
  };
}
