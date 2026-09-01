import { describe, expect, it } from "bun:test";

import { checkReleaseConsistency } from "./check-release-consistency";

describe("checkReleaseConsistency", () => {
	it("accepts the release candidate with its locally verifiable previous-release baseline", () => {
		expect(() => checkReleaseConsistency()).not.toThrow();
	});
});
