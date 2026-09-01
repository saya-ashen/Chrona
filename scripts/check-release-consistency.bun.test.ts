import { describe, expect, it } from "bun:test";

import { checkReleaseConsistency } from "./check-release-consistency";

describe("checkReleaseConsistency", () => {
	it("accepts the locally verifiable v0.2.0 release baseline", () => {
		expect(() => checkReleaseConsistency()).not.toThrow();
	});
});
