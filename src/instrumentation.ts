export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startAutoStartScheduler } = await import("@/modules/scheduler/auto-start-runner");
  startAutoStartScheduler();
}
