import { plugin } from "bun";
import { join } from "node:path";

const sdk = process.env.CHRONA_SDK;
if (!sdk) throw new Error("CHRONA_SDK is required by the SDK loader");
plugin({ name: "chrona-sdk", setup(build) {
  for (const [name, file] of [["chrona", "sdk.ts"], ["chrona/testing", "testing.ts"], ["chrona/preview", "preview.ts"], ["chrona/process", "process.ts"]]) {
    build.module(name, () => ({ contents: "export * from " + JSON.stringify(join(sdk, file)), loader: "js" }));
  }
} });
