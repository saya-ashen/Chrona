const activeControllers = new Map<string, Set<AbortController>>();

export function registerActiveTaskPlanGeneration(featureRunId: string) {
	const controller = new AbortController();
	const controllers = activeControllers.get(featureRunId) ?? new Set();
	controllers.add(controller);
	activeControllers.set(featureRunId, controllers);
	return {
		signal: controller.signal,
		dispose() {
			controllers.delete(controller);
			if (controllers.size === 0) activeControllers.delete(featureRunId);
		},
	};
}

export function abortActiveTaskPlanGeneration(featureRunId: string) {
	const controllers = activeControllers.get(featureRunId);
	if (!controllers) return 0;
	for (const controller of controllers) {
		controller.abort("Task plan generation was cancelled.");
	}
	activeControllers.delete(featureRunId);
	return controllers.size;
}
