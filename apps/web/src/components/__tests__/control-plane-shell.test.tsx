import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createScheduledTask: vi.fn(),
	apiJson: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useLocation: () => ({
		pathname: "/en/tasks",
		search: "?filter=active",
		hash: "#current",
	}),
	useNavigate: () => vi.fn(),
	useRevalidator: () => ({ revalidate: vi.fn() }),
}));

vi.mock("@shared/http", () => ({
	apiJson: mocks.apiJson,
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));
vi.mock("@shared/ui", () => ({
	Button: ({ children, ...props }: { children: ReactNode }) => (
		<button {...props}>{children}</button>
	),
	cn: (...classes: Array<string | false | null | undefined>) =>
		classes.filter(Boolean).join(" "),
	Sidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
	SidebarContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarGroup: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarGroupContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
	SidebarMenuButton: ({ children }: { children: ReactNode }) => (
		<button>{children}</button>
	),
	SidebarMenuItem: ({ children }: { children: ReactNode }) => (
		<li>{children}</li>
	),
	SidebarProvider: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("@features/schedule", () => ({
	createScheduledTask: mocks.createScheduledTask,
	TaskCreateDialog: ({
		isOpen,
		onSubmit,
	}: {
		isOpen: boolean;
		onSubmit: (input: {
			title: string;
			description: string;
			priority: "High";
			autoExecute: boolean;
			autoPlanGenerationEnabled: boolean;
			autoPlanGenerationTiming: "on_schedule";
			autoExecuteTiming: "on_schedule";
			dueAt: Date | null;
			scheduledStartAt: Date;
			scheduledEndAt: Date;
			recurrenceRule: string | null;
			recurrenceAnchorStartAt: string | null;
			recurrenceAnchorEndAt: string | null;
			aiClientId: string | null;
		}) => Promise<void>;
	}) =>
		isOpen ? (
			<div role="dialog">
				<button
					type="button"
					onClick={() =>
						onSubmit({
							title: "Created from shell",
							description: "Shell description",
							priority: "High",
							autoExecute: true,
							autoPlanGenerationEnabled: false,
							autoPlanGenerationTiming: "on_schedule",
							autoExecuteTiming: "on_schedule",
							dueAt: null,
							scheduledStartAt: new Date(2026, 3, 15, 9),
							scheduledEndAt: new Date(2026, 3, 15, 10),
							recurrenceRule: "FREQ=WEEKLY",
							recurrenceAnchorStartAt: "2026-04-15T09:00:00.000Z",
							recurrenceAnchorEndAt: "2026-04-15T10:00:00.000Z",
							aiClientId: "client-1",
						})
					}
				>
					Submit task
				</button>
			</div>
		) : null,
}));
vi.mock("@chrona/i18n", () => ({
	useI18n: () => ({
		t: (key: string) =>
			({
				"nav.brandTitle": "Chrona",
				"nav.brandTagline": "Human-AI task work",
				"nav.schedule": "Schedule",
				"nav.actionCenter": "Action Center",
				"nav.tasks": "Tasks",
				"nav.settings": "Settings",
				"nav.newTask": "New Task",
				"components.assistantSurface.entryLabel": "Assistant",
				"locale.label": "Locale",
				"locale.en": "English",
				"locale.zh": "Chinese",
			})[key] ?? key,
	}),
	getAssistantSurfaceMessages: () => ({
		statusLabel: "Status",
		noActiveContext: "No active assistant context",
	}),
	useLocale: () => "en",
	localizeHref: (locale: string, href: string) =>
		/^\/(?:en|zh)(?:\/|$)/.test(href) ? href : `/${locale}${href}`,
	stripLocalePrefix: (pathname: string) =>
		pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/",
	locales: ["en", "zh"],
}));

import { ControlPlaneShell } from "@features/mcp-control-plane";

beforeEach(() => {
	mocks.apiJson.mockImplementation((path: string) => {
		if (path === "/api/workspaces/ws-1/preferences/start-with-chrona")
			return Promise.resolve({ completedAt: "2026-01-01T00:00:00.000Z" });
		if (path === "/api/schedule?workspaceId=ws-1")
			return Promise.resolve({
				availableAiClients: []
			});
		return Promise.resolve({ clients: [], tasks: [], total: 0 });
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ControlPlaneShell", () => {
	it("keeps localized navigation and disabled assistant display", () => {
		render(
			<ControlPlaneShell
				defaultWorkspace={{ id: "ws-1", name: "Default" }}
				assistantSummary={{ label: "PAGE-AWARE AI", value: "Task ready" }}
			>
				<div>Workspace body</div>
			</ControlPlaneShell>,
		);
		expect(screen.getAllByRole("link", { name: "Chrona" })[0]).toHaveAttribute(
			"href",
			"/en/schedule",
		);
		expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
			"href",
			"/en/tasks",
		);
		expect(screen.getByRole("button", { name: "Assistant" })).toBeDisabled();
		expect(screen.getByText("Task ready")).toBeInTheDocument();
	});

	it("preserves current route when switching locale", () => {
		render(
			<ControlPlaneShell defaultWorkspace={{ id: "ws-1", name: "Default" }}>
				<div>Workspace body</div>
			</ControlPlaneShell>,
		);
		expect(screen.getByRole("link", { name: "Chinese" })).toHaveAttribute(
			"href",
			"/zh/tasks?filter=active#current",
		);
		expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
			"href",
			"/en/tasks?filter=active#current",
		);
	});

	it("hides the assistant display when no summary is available", () => {
		render(
			<ControlPlaneShell defaultWorkspace={{ id: "ws-1", name: "Default" }}>
				<div>Workspace body</div>
			</ControlPlaneShell>,
		);
		expect(
			screen.queryByRole("button", { name: "Assistant" }),
		).not.toBeInTheDocument();
	});

	it("creates scheduled tasks through the schedule feature public action", async () => {
		mocks.createScheduledTask.mockResolvedValue({ taskId: "created-task" });
		const user = userEvent.setup();
		render(
			<ControlPlaneShell defaultWorkspace={{ id: "ws-1", name: "Default" }}>
				<div>Workspace body</div>
			</ControlPlaneShell>,
		);
		await user.click(screen.getByRole("button", { name: "New Task" }));
		await user.click(screen.getByRole("button", { name: "Submit task" }));
		await waitFor(() =>
			expect(mocks.createScheduledTask).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: "ws-1",
					title: "Created from shell",
					autoPlanGeneration: true,
					autoExecute: true,
					recurrenceRule: "FREQ=WEEKLY",
				}),
			),
		);
	});
});
