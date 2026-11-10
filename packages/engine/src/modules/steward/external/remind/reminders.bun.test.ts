import { test } from "bun:test";
import { runOfflineChecks } from "./reminders.test";

test("Remind owns recurrence, durable delivery and unknown-stop recovery without kernel schedules", runOfflineChecks);
