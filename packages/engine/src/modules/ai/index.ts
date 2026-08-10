export type {
	DebugProfiledProviderClient,
	EngineAiClient,
	EngineProviderClient,
	EngineLlmClient,
	EngineHermesClient,
	EngineDebugClient,
	EngineClaudeCodeClient,
	EngineCodexClient,
	EngineOmpClient,
} from "./runtime/client-registry";
export {
	getProviderBaseUrl,
	AiClientRegistry,
	aiClientRegistry,
} from "./runtime/client-registry";
export {
	getAiClient,
	getAiClientForFeature,
	getAiClientForTask,
	requireAiClient,
} from "./runtime/client-resolution";
export { aiChat } from "./runtime/ai-service";
export { chat } from "./feature-normalizers";
export { dispatchStream, suggestStream } from "./streaming";
export {
	AiClientManagement,
	aiClientManagement,
} from "./management/ai-client-management";
export type {
	ProviderFeatureRequest,
	ProviderRunRequestOptions,
} from "./providers";
export {
	testAiClientAvailability,
	runProviderRequest,
	extractJSON,
	llmCall,
	buildProviderFeatureRequest,
	buildFeatureTerminalTool,
	CHRONA_FEATURE_TERMINAL_TOOL_NAME,
	dispatch,
	dispatchFeaturePayload,
} from "./providers";
export {
	createProviderStreamEventBoundary,
	ProviderStreamContractError,
} from "./provider-stream-contract";
export type { ProviderStreamEventBoundary } from "./provider-stream-contract";
export { analyzeConflicts, analyzeConflictsSmart } from "./conflict-analyzer";
export {
	detectDependencyConflicts,
	detectFragmentation,
	detectOverload,
	detectTimeOverlaps,
} from "./conflict-detector";
export {
	defineAiFeature,
	AiFeatureDefinitionRegistry,
	runAiFeature,
	startOrAttachAiFeatureRun,
	executeAiFeatureRunById,
	AiFeatureRuntimeError,
	stableJsonHash,
	stableJsonStringify,
} from "./feature-runtime";
export {
	commitAiFeatureRunAtomically,
	PrismaAiFeatureRunStore,
} from "./runtime/feature-runtime/prisma-run-store";
export { FoundationProviderRuntime } from "./runtime/feature-runtime/foundation-provider-runtime";
export {
	runAiFeatureWithRuntime,
	startAiFeatureWithRuntime,
	resumeAiFeatureRun,
	recoverAiFeatureRuns,
	startAiFeatureRecoveryWorker,
} from "./runtime/feature-runtime/runtime-service";
export { readAiFeatureRunPublic } from "./runtime/feature-runtime/public-query";
export type {
	AiFeatureActionDefinition,
	AiFeatureArtifactDefinition,
	AiFeatureCommitContext,
	AiFeatureCommitResult,
	AiFeatureCompletionContext,
	AiFeatureDefinition,
	AiFeatureObservationDefinition,
	AiFeatureRunnerPorts,
	AiFeatureProviderPort,
	AiFeatureProviderStart,
	DefinedAiFeature,
	AiFeatureRunPublicRead,
	ReadAiFeatureRunPublicInput,
	AiFeatureRunRecord,
	AiFeatureRunRepositoryPort,
	AiFeatureRunActionRecord,
} from "./feature-runtime";
export type { AtomicAiFeatureRunCommit } from "./runtime/feature-runtime/prisma-run-store";
export type {
	AiFeatureRecoveryWorker,
	DefaultAiFeatureRunInput,
} from "./runtime/feature-runtime/runtime-service";
