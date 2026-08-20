type RuntimeInvocationScope = {
  runId: string;
  nodeAttemptId: string;
};

type ActiveRuntimeInvocation = {
  controller: AbortController;
  dispose: () => void;
};

const activeInvocations = new Map<string, Set<AbortController>>();

function scopeKey(scope: RuntimeInvocationScope) {
  return `${scope.runId}:${scope.nodeAttemptId}`;
}

export function registerActiveRuntimeInvocation(
  scope: RuntimeInvocationScope,
): ActiveRuntimeInvocation {
  const key = scopeKey(scope);
  const controller = new AbortController();
  const controllers = activeInvocations.get(key) ?? new Set<AbortController>();
  controllers.add(controller);
  activeInvocations.set(key, controllers);
  return {
    controller,
    dispose: () => {
      const current = activeInvocations.get(key);
      current?.delete(controller);
      if (current?.size === 0) activeInvocations.delete(key);
    },
  };
}

export function abortActiveRuntimeInvocations(scope: RuntimeInvocationScope) {
  const controllers = activeInvocations.get(scopeKey(scope));
  if (!controllers) return 0;
  for (const controller of controllers) {
    controller.abort("Chrona terminal action recorded");
  }
  return controllers.size;
}

export function resetActiveRuntimeInvocationsForTest() {
  activeInvocations.clear();
}
