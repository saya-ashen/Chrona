import { dispatchExecutorProcess } from "./executor-entry";
import type { StartCommandOptions } from "./program.js";

async function bootServer() {
  const { startBunServer } = await import("@server/index.bun");
  await startBunServer();
}

function startServer(options: StartCommandOptions) {
  return import("./start-server.js").then(({ startChronaServer }) => startChronaServer(bootServer, options));
}

async function main() {
  const args = process.argv.slice(2);
  if (await dispatchExecutorProcess(args)) return;
  const { createProgram } = await import("./program.js");

  if (args.length > 0 && args[0] !== "start") {
    await createProgram({ startServer }).parseAsync(process.argv);
    return;
  }

  const startArgs = args[0] === "start" ? args.slice(1) : [];
  const program = createProgram({ startServer });
  const startCommand = program.commands.find((command) => command.name() === "start");
  if (!startCommand) {
    throw new Error("chrona start command is not registered.");
  }

  await startCommand.parseAsync(["node", "chrona", ...startArgs]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
