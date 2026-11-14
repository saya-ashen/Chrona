// Author-test entry: select fresh private data before loading the real application.
import { chrona } from "chrona";

const directory = process.env.CHRONA_MIND_OFFLINE_STATE;
if (!directory) throw new Error("Offline entry requires an explicit temporary state directory");
chrona.paths.data = directory;
await import("./index");
