import { z } from "zod";

const modulePath = z.string().min(1).max(1024).refine(path =>
  !path.startsWith("/") && !/[\\:\p{Cc}]/u.test(path)
  && path.split("/").every(part => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"),
"Expected a safe module-relative file path");

/** Script shorthand remains compatible; explicit entries execute a local file or an installed host interpreter. */
export const moduleEntrySchema = z.union([
  z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  z.object({
    path: modulePath,
    args: z.array(z.string().max(2048).refine(arg => !arg.includes("\0"), "Arguments cannot contain NUL")).max(32).default([]),
    runtime: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/).optional(),
  }).strict(),
]);
export type ModuleEntry = z.infer<typeof moduleEntrySchema>;
