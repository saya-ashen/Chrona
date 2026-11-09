import { z } from "zod";

// Configure before catalog/json-render schemas are created: Web's CSP forbids eval.
z.config({ jitless: true });
