import type { ApiType } from "@chrona/server/routes";

import { createRpcClient } from "@shared/http";

export const api = createRpcClient<ApiType>();

export type { ApiType } from "@chrona/server/routes";
