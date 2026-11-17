/** Test-only helpers; never imported by production consumers. */
export { testDb } from "./test-db";
// The built-in qq module's pure parts, for server tests that drive them through Chrona's real routed calls.
export { createQqBotHandler, createQqBotState, type QqReplyItem } from "../../../.generated/applications/qq/bot";
export { downloadQqAttachment, type QqC2cMessage } from "../../../.generated/applications/qq/official";
export { createRelay, qqReplyText } from "../../../.generated/applications/qq/relay";
export { callSync, callsSettled, runDueCalls } from "./modules/module-calls";
export { notices } from "./test-notices";
export { handleModuleCall } from "./modules/module-effects";
export { builtinEntry, qqEntry } from "./test-entry";

export { createQqConversations } from "../../../.generated/applications/qq/conversations";

export { agentFixture } from "../../../scripts/agent-integration/agent-application.fixtures";
export { kernelOrigin } from "./modules/module-calls";
