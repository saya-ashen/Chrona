#!/usr/bin/env bun
/**
 * Entry point — delegates to @chrona/openclaw-bridge package.
 * Run: bun services/openclaw-bridge/server.ts
 */
import { startBridgeServer } from "../../packages/openclaw-bridge/src/server";

await startBridgeServer();
