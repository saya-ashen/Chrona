import { defineConfig } from "prisma/config";
import { applyChronaRuntimeConfigToEnv, chronaDatabaseUrl } from "./packages/runtime-config/src/runtime-config";

applyChronaRuntimeConfigToEnv(process.env);

export default defineConfig({
  schema: "packages/db/prisma/schema.prisma",
  migrations: {
    path: "packages/db/prisma/migrations",
  },
  datasource: {
    url: chronaDatabaseUrl(),
  },
});
