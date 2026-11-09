import { test } from "bun:test";
import { checkSystemPages, checkHealthRendering } from "./test-system-pages";

test("system pages, adapters and settings use the contracted UI surface", checkSystemPages);
test("observed diagnostics and failures stay explicit", checkHealthRendering);
