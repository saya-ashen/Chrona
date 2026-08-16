import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@chrona/i18n/react", () => ({
	useI18n: () => ({
		t: (key: string) =>
			({
				"components.accessKeyUnlock.eyebrow": "Protected Chrona",
				"components.accessKeyUnlock.title": "Enter access key",
				"components.accessKeyUnlock.description":
					"Use the server access key to continue.",
				"components.accessKeyUnlock.keyLabel": "Access key",
				"components.accessKeyUnlock.keyPlaceholder": "Access key",
				"components.accessKeyUnlock.rememberLabel": "Remember this key",
				"components.accessKeyUnlock.rememberHint": "Store it for this browser.",
				"components.accessKeyUnlock.submit": "Unlock",
			})[key] ?? key,
	}),
}));

import { AccessKeyUnlock } from "../access-key-unlock";

afterEach(cleanup);

describe("AccessKeyUnlock", () => {
	it("[BOOT-005] requires a key and submits its trimmed value with persistence choice", async () => {
		const user = userEvent.setup();
		const onUnlock = vi.fn();
		render(<AccessKeyUnlock onUnlock={onUnlock} />);

		const submit = screen.getByRole("button", { name: "Unlock" });
		expect(submit).toBeDisabled();

		await user.type(screen.getByLabelText("Access key"), "  correct-key  ");
		await user.click(
			screen.getByRole("checkbox", { name: "Remember this key" }),
		);
		await user.click(submit);

		expect(onUnlock).toHaveBeenCalledWith("correct-key", true);
	});
});
