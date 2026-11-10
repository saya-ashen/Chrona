import { dlopen, FFIType, ptr, read } from "bun:ffi";
import type { FileHandle } from "node:fs/promises";
import { AuthorError } from "./contracts";

function publicationLibrary() {
  // glibc and musl use different sonames. Both expose the Linux primitive.
  for (const name of ["libc.so.6", "libc.so"]) {
    try {
      return dlopen(name, {
        renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        __errno_location: { args: [], returns: FFIType.ptr },
      });
    } catch { /* Try the other supported Linux libc name. */ }
  }
  throw new AuthorError("source_io", "Atomic no-replace directory publication is unavailable on this host.");
}
/** Node rename can replace an empty directory. Linux RENAME_NOREPLACE is required
 * for atomic whole-tree publication without a destination-clobber race. Like the
 * existing descriptor traversal this is Linux-only; missing support fails closed. */
export function publishDirectory(parent: FileHandle, temporary: string, destination: string) {
  const library = publicationLibrary();
  try {
    const from = Buffer.from(`${temporary}\0`), to = Buffer.from(`${destination}\0`);
    if (library.symbols.renameat2(parent.fd, ptr(from), parent.fd, ptr(to), 1) !== 0) {
      const errno = read.i32(library.symbols.__errno_location()!);
      throw new AuthorError(errno === 17 ? "conflict" : "source_io", "Material destination is occupied or atomic publication failed.");
    }
  } finally { library.close(); }
}
