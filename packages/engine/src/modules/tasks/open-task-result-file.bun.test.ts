import { mkdir, readdir, rm, symlink, truncate } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "../../../../db/src/db";
import {
	resetTestDb,
	seedTask,
	seedWorkspace,
} from "../../../../db/src/test-support";
import {
	MAX_RESULT_FILE_BYTES,
	generatedFilesRoot,
} from "./result-file-access";
import { openTaskResultFile } from "./open-task-result-file";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

async function resultSnapshotDirectories() {
	return (await readdir(tmpdir()))
		.filter((name) => name.startsWith("chrona-result-file-"))
		.sort();
}

describe("openTaskResultFile", () => {
	beforeEach(async () => {
		await resetTestDb();
	});

	it.each(["FileRef", "ResultDeliverable", "WorkspaceArtifactItem", "Table"])(
		"downloads generated files registered for same-task results",
		async (componentType) => {
			const { workspaceId } = await seedWorkspace("Result download");
			const { taskId } = await seedTask(workspaceId, {
				title: "Create report",
			});
			const fixtureScope = `download-test-${randomUUID()}`;
			const reference = `generated://${fixtureScope}/node/report.md`;
			const fixtureRoot = join(generatedFilesRoot(), fixtureScope);
			const filePath = join(fixtureRoot, "node", "report.md");
			const supportingReference = `generated://${fixtureScope}/node/support.json`;
			const supportingPath = join(fixtureRoot, "node", "support.json");
			await mkdir(join(fixtureRoot, "node"), { recursive: true });
			await Bun.write(filePath, "# Report");
			await Bun.write(supportingPath, '{"ok":true}');

			await db.taskPlan.create({
				data: {
					planId: "download-plan",
					workspaceId,
					taskId,
					revision: 1,
					status: "Accepted",
					compiledPlan: {},
				},
			});
			const run = await db.run.create({
				data: {
					taskId,
					runtimeName: "test",
					status: "Completed",
					triggeredBy: "user",
				},
			});
			const artifact = await db.artifact.create({
				data: {
					workspaceId,
					taskId,
					runId: run.id,
					type: "file",
					title: "Report",
					uri: reference,
					metadata: {
						checksumAlgorithm: "sha256",
						checksum: createHash("sha256").update("# Report").digest("hex"),
						size: Buffer.byteLength("# Report"),
						mimeType: "text/markdown",
					},
				},
			});
			await db.artifact.create({
				data: {
					workspaceId,
					taskId,
					runId: run.id,
					type: "file",
					title: "Supporting data",
					uri: supportingReference,
					metadata: {
						checksumAlgorithm: "sha256",
						checksum: createHash("sha256").update('{"ok":true}').digest("hex"),
						size: Buffer.byteLength('{"ok":true}'),
						mimeType: "application/json",
					},
				},
			});
			const directoryReference = `generated://${fixtureScope}/node`;
			const symlinkReference = `generated://${fixtureScope}/node/escape.md`;
			await symlink(
				join(tmpdir(), "chrona-result-secret.md"),
				join(fixtureRoot, "node", "escape.md"),
			);
			for (const uri of [directoryReference, symlinkReference]) {
				await db.artifact.create({
					data: {
						workspaceId,
						taskId,
						runId: run.id,
						type: "file",
						title: "Boundary fixture",
						uri,
						metadata: {
							checksumAlgorithm: "sha256",
							checksum: "0".repeat(64),
							size: 0,
							mimeType: "text/plain",
						},
					},
				});
			}
			await db.event.create({
				data: {
					workspaceId,
					taskId,
					runId: run.id,
					planId: "download-plan",
					eventType: "provider.run_completed",
					actorType: "runtime",
					source: "provider",
					payload: {},
					ingestSequence: 1,
				},
			});
			await db.taskPlanRun.create({
				data: {
					workspaceId,
					taskId,
					planId: "download-plan",
					planRun: {
						planRun: {
							id: "persisted-run-metadata",
						},
						mutableGraph: {
							planOutput: {
								finalizedResult: {
									spec: {
										root: "root",
										elements: {
											root: { type: "Stack", props: {}, children: ["report"] },
											report: {
												type: componentType,
												props: { artifactRef: aiArtifactRef(artifact.id) },
											},
										},
									},
								},
							},
						},
					},
				},
			});

			try {
				const result = await openTaskResultFile({
					taskId,
					requestedPath: reference,
				});
				expect(result.filename).toBe("report.md");
				expect(await new Response(result.stream).text()).toBe("# Report");

				const snapshotsBeforeCancel = await resultSnapshotDirectories();
				const cancelled = await openTaskResultFile({
					taskId,
					requestedPath: reference,
				});
				expect(await resultSnapshotDirectories()).toHaveLength(
					snapshotsBeforeCancel.length + 1,
				);
				await cancelled.stream.cancel();
				expect(await resultSnapshotDirectories()).toEqual(snapshotsBeforeCancel);

				const supportingResult = await openTaskResultFile({
					taskId,
					requestedPath: supportingReference,
				});
				expect(supportingResult.filename).toBe("support.json");
				expect(await new Response(supportingResult.stream).text()).toBe(
					'{"ok":true}',
				);

				await expect(
					openTaskResultFile({ taskId, requestedPath: directoryReference }),
				).rejects.toThrow("regular files");
				await expect(
					openTaskResultFile({ taskId, requestedPath: symlinkReference }),
				).rejects.toThrow("Symbolic links");

				await truncate(filePath, MAX_RESULT_FILE_BYTES + 1);
				await expect(
					openTaskResultFile({ taskId, requestedPath: reference }),
				).rejects.toThrow("maximum allowed result size");
				await Bun.write(filePath, "# Report");

				await Bun.write(filePath, "# Tampered report");
				await expect(
					openTaskResultFile({ taskId, requestedPath: reference }),
				).rejects.toThrow(/changed after registration/i);

				await expect(
					openTaskResultFile({
						taskId,
						requestedPath: `generated://${fixtureScope}/node/unreferenced.md`,
					}),
				).rejects.toThrow(/not a registered task result Artifact/i);
				await expect(
					openTaskResultFile({ taskId, requestedPath: filePath }),
				).rejects.toThrow(
					"Only generated task result files can be downloaded directly",
				);
			} finally {
				await rm(fixtureRoot, {
					recursive: true,
					force: true,
				});
			}
		},
	);
});
