"use client";

import {
	Bell,
	CalendarDays,
	ClipboardList,
	LayoutDashboard,
	Plus,
	Target,
	Settings,
} from "lucide-react";
import {
	useEffect,
	useMemo,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import {
	createScheduledTask,
	TaskCreateDialog,
	type SchedulePageData,
} from "@features/schedule";
import { createGoalWithFirstTask } from "@features/goals";
import { apiJson } from "@shared/http";
import {
	Button,
	cn,
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@shared/ui";
import { releasedProviderTypes } from "@chrona/contracts";
import { localizeHref, useI18n, useLocale } from "@chrona/i18n";
import { LocalizedLink } from "./localized-link";
import { LocaleSwitcher } from "./locale-switcher";
import { StartWithChrona } from "./start-with-chrona";

export type ControlPlaneShellProps = {
	children: ReactNode;
	defaultWorkspace: {
		id: string;
		name: string;
	};
	assistantSummary?: {
		label: string;
		value: string;
	};
};

type NavEntry = {
	href: string;
	label: string;
	icon: typeof CalendarDays;
	active: boolean;
};

type StartWithChronaPreferenceResponse = {
	completedAt?: string | null;
};

type TaskCreateConfig = Pick<SchedulePageData, "availableAiClients">;

const EMPTY_TASK_CREATE_CONFIG: TaskCreateConfig = {
	availableAiClients: [],
};
const RELEASED_PROVIDER_TYPES = new Set<string>(releasedProviderTypes);

function startWithChronaPreferencePath(workspaceId: string) {
	return `/api/workspaces/${encodeURIComponent(workspaceId)}/preferences/start-with-chrona`;
}

function completedAtFromPreference(
	payload: StartWithChronaPreferenceResponse,
): string | null {
	return typeof payload.completedAt === "string" && payload.completedAt.trim()
		? payload.completedAt
		: null;
}

function hasEnabledPlanningClient(config: TaskCreateConfig): boolean {
	return config.availableAiClients?.some(
		(client) => client.enabled && RELEASED_PROVIDER_TYPES.has(client.type),
	) === true;
}

async function requestInitialTaskPlan(taskId: string): Promise<void> {
	await apiJson(`/api/work/${encodeURIComponent(taskId)}/commands`, {
		method: "POST",
		body: JSON.stringify({
			type: "plan.generate",
			forceRefresh: true,
			idempotencyKey: uuidv4(),
			userInstruction: null,
			workBlockId: null,
			selectedNodeId: null,
		}),
	});
}

export function ControlPlaneShell({
	children,
	defaultWorkspace: _defaultWorkspace,
	assistantSummary,
}: ControlPlaneShellProps) {
	const { t } = useI18n();
	const locale = useLocale();
	const navigate = useNavigate();
	const { revalidate } = useRevalidator();
	const pathname =
		useLocation().pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/";
	const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
	const [isCreatingTask, setIsCreatingTask] = useState(false);
	const [taskCreateConfig, setTaskCreateConfig] = useState<TaskCreateConfig>(
		EMPTY_TASK_CREATE_CONFIG,
	);
	const [createdOnboardingTaskId, setCreatedOnboardingTaskId] = useState<
		string | null
	>(null);
	const [useSafeDemoDefaults, setUseSafeDemoDefaults] = useState(false);
	const [startWithChronaCompletedAt, setStartWithChronaCompletedAt] = useState<
		string | null | undefined
	>(undefined);
	const taskDialogDefaults = useMemo(() => {
		const initialStartAt = new Date();
		initialStartAt.setHours(9, 0, 0, 0);
		const initialEndAt = new Date(initialStartAt);
		initialEndAt.setHours(10, 0, 0, 0);

		return { initialStartAt, initialEndAt };
	}, [showCreateTaskDialog]);
	useEffect(() => {
		let cancelled = false;
		const path = startWithChronaPreferencePath(_defaultWorkspace.id);
		setStartWithChronaCompletedAt(undefined);

		apiJson<StartWithChronaPreferenceResponse>(path)
			.then((payload) => {
				if (!cancelled)
					setStartWithChronaCompletedAt(completedAtFromPreference(payload));
			})
			.catch(() => {
				if (!cancelled) setStartWithChronaCompletedAt(null);
			});

		return () => {
			cancelled = true;
		};
	}, [_defaultWorkspace.id]);
	useEffect(() => {
		if (!showCreateTaskDialog) return;
		let cancelled = false;

		apiJson<Pick<SchedulePageData, "availableAiClients">>(
			`/api/schedule?workspaceId=${encodeURIComponent(_defaultWorkspace.id)}`,
		)
			.then((payload) => {
				if (!cancelled) setTaskCreateConfig(payload);
			})
			.catch(() => {
				if (!cancelled) setTaskCreateConfig(EMPTY_TASK_CREATE_CONFIG);
			});

		return () => {
			cancelled = true;
		};
	}, [_defaultWorkspace.id, showCreateTaskDialog]);

	const completeStartWithChrona = async () => {
		const completedAt = new Date().toISOString();
		setStartWithChronaCompletedAt(completedAt);
		await apiJson<StartWithChronaPreferenceResponse>(
			startWithChronaPreferencePath(_defaultWorkspace.id),
			{
				method: "PATCH",
				body: JSON.stringify({ completedAt }),
			},
		);
	};
	const breadcrumb = pathname
		.split("/")
		.filter(Boolean)
		.flatMap((segment) => {
			if (segment === "dashboard") return [t("nav.dashboard")];
			if (segment === "schedule") return [t("nav.schedule")];
			if (segment === "tasks") return [t("nav.tasks")];
			if (segment === "goals") return [t("nav.goals")];
			if (segment === "settings") return [t("nav.settings")];
			if (segment === "action-center") return [t("nav.actionCenter")];
			if (segment === "work") return [t("common.work")];
			if (/^(?:goal_|task_|cm[a-z0-9]{8,})/i.test(segment)) return [];
			return [segment];
		});
	const navItems: NavEntry[] = [
		{
			href: "/dashboard",
			label: t("nav.dashboard"),
			icon: LayoutDashboard,
			active: pathname.startsWith("/dashboard"),
		},
		{
			href: "/schedule",
			label: t("nav.schedule"),
			icon: CalendarDays,
			active: pathname.startsWith("/schedule"),
		},
		{
			href: "/goals",
			label: t("nav.goals"),
			icon: Target,
			active: pathname.startsWith("/goals"),
		},
		{
			href: "/tasks",
			label: t("nav.tasks"),
			icon: ClipboardList,
			active: pathname.startsWith("/tasks"),
		},
		{
			href: "/action-center",
			label: t("nav.actionCenter"),
			icon: Bell,
			active: pathname.startsWith("/action-center"),
		},
		// Memory intentionally stays out of primary navigation until it has clear,
		// actionable product value beyond Dashboard and task workspace context.
		{
			href: "/settings",
			label: t("nav.settings"),
			icon: Settings,
			active: pathname.startsWith("/settings"),
		},
	];
	const shouldShowStartWithChrona =
		[
			"/dashboard",
			"/schedule",
			"/goals",
			"/tasks",
			"/action-center",
			"/settings",
		].includes(pathname) && startWithChronaCompletedAt === null;

	return (
		<SidebarProvider
			defaultOpen
			className="h-screen min-h-0 bg-workspace text-foreground"
			style={{ "--sidebar-width": "240px" } as CSSProperties}
		>
			<Sidebar
				collapsible="none"
				className="hidden border-r border-sidebar-border bg-sidebar shadow-[8px_0_30px_rgb(31_32_45/0.05)] xl:flex"
			>
				<SidebarHeader className="border-b border-sidebar-border bg-sidebar px-4 py-4">
					<LocalizedLink
						href="/schedule"
						aria-label={t("nav.brandTitle")}
						className="group flex min-w-0 items-center gap-2.5"
					>
						<img
							src="/favicon.png"
							alt=""
							aria-hidden="true"
							className="h-10 w-10 shrink-0 rounded-2xl object-cover ring-1 ring-border mix-blend-multiply dark:mix-blend-screen"
						/>
						<span className="min-w-0">
							<span className="block truncate text-[1.45rem] font-medium tracking-[-0.04em] leading-none text-foreground">
								{t("nav.brandTitle")}
							</span>
							<span className="mt-1 block truncate text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-muted-foreground">
								{t("nav.brandTagline")}
							</span>
						</span>
					</LocalizedLink>
				</SidebarHeader>

				<SidebarContent>
					<SidebarGroup className="px-3 py-4">
						<SidebarGroupContent>
							<SidebarMenu aria-label="Primary" className="gap-1.5">
								{navItems.map((item) => {
									const Icon = item.icon;

									return (
										<SidebarMenuItem key={`${item.href}-${item.label}`}>
											<SidebarMenuButton
												render={
													<LocalizedLink
														href={item.href}
														aria-current={item.active ? "page" : undefined}
													/>
												}
												isActive={item.active}
												className={cn(
													"h-auto rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors",
													item.active
														? "border-primary-border bg-primary-soft text-primary shadow-sm hover:bg-primary-soft-hover hover:text-primary [&_svg]:text-primary"
														: "border-transparent text-muted-foreground hover:border-panel-border hover:bg-panel hover:text-foreground",
												)}
											>
												<Icon className="size-4" />
												<span>{item.label}</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="relative z-50 border-b border-panel-border bg-panel/92 shadow-[0_1px_12px_rgb(31_32_45/0.04)] supports-[backdrop-filter]:backdrop-blur-md">
					<div className="relative mx-auto flex h-16 w-full max-w-[1600px] items-center gap-2 px-4 sm:gap-3 sm:px-6 xl:px-8">
						<div className="flex min-w-0 shrink items-center gap-3">
							<LocalizedLink
								href="/schedule"
								aria-label={t("nav.brandTitle")}
								className="flex shrink-0 items-center gap-2 xl:hidden"
							>
								<img
									src="/favicon.png"
									alt=""
									aria-hidden="true"
									className="h-9 w-9 shrink-0 rounded-2xl object-cover ring-1 ring-border mix-blend-multiply dark:mix-blend-screen"
								/>
								<span className="hidden truncate text-sm font-semibold tracking-tight text-foreground sm:block">
									{t("nav.brandTitle")}
								</span>
							</LocalizedLink>

							<p className="hidden min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground xl:block">
								{breadcrumb.join(" / ") || t("nav.schedule")}
							</p>
						</div>

						{assistantSummary?.value ? (
							<div className="flex min-w-0 flex-1 items-center justify-center">
								<button
									type="button"
									disabled
									data-assistant-surface-header-drawer-button="true"
									aria-label={t("components.assistantSurface.entryLabel")}
									className="group inline-flex h-9 max-w-[520px] items-center gap-2 overflow-hidden rounded-full border border-border/60 bg-muted/40 px-2.5 text-sm text-muted-foreground"
								>
									<span className="flex min-w-0 flex-1 items-center gap-1.5">
										<span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
											{assistantSummary.label}
										</span>
										<span className="min-w-0 max-w-[220px] truncate text-xs font-semibold text-primary lg:max-w-[360px]">
											{assistantSummary.value}
										</span>
									</span>
								</button>
							</div>
						) : (
							<div className="min-w-0 flex-1" aria-hidden />
						)}

						<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
							<Button
								type="button"
								onClick={() => setShowCreateTaskDialog(true)}
								variant="default"
								size="sm"
								aria-label={t("nav.newTask")}
								className="h-9 gap-1.5 px-3.5 sm:px-4"
							>
								<Plus className="size-4" />
								<span className="hidden sm:inline">{t("nav.newTask")}</span>
							</Button>
							<LocaleSwitcher />
						</div>
					</div>
				</header>
				<main className="chrona-app-main flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] sm:px-6 xl:px-8 xl:pb-4">
					{shouldShowStartWithChrona ? (
						<StartWithChrona
							className="mb-4"
							createdTaskId={createdOnboardingTaskId}
							workspaceId={_defaultWorkspace.id}
							isComplete={false}
							onCreateTask={() => setShowCreateTaskDialog(true)}
							onCreateSafeDemo={() => {
								setUseSafeDemoDefaults(true);
								setShowCreateTaskDialog(true);
							}}
							onOpenCreatedTask={(taskId) => {
								void completeStartWithChrona();
								void navigate(localizeHref(locale, `/tasks/${taskId}`));
							}}
						/>
					) : null}
					{children}
				</main>

				<nav
					aria-label="Primary"
					className="fixed inset-x-0 bottom-0 z-40 border-t border-panel-border bg-panel/94 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(31_32_45/0.08)] backdrop-blur-md xl:hidden"
				>
					<ul className="mx-auto flex max-w-lg items-stretch justify-around">
						{navItems.map((item) => {
							const Icon = item.icon;
							return (
								<li key={`mobile-${item.href}`} className="flex-1">
									<LocalizedLink
										href={item.href}
										aria-current={item.active ? "page" : undefined}
										className={cn(
											"flex min-h-14 flex-col items-center gap-1 px-1 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11px] font-medium transition-colors",
											item.active
												? "text-primary"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Icon className="size-5" />
										<span className="truncate">{item.label}</span>
									</LocalizedLink>
								</li>
							);
						})}
					</ul>
				</nav>
			</div>
			<TaskCreateDialog
				initialTitle={
					useSafeDemoDefaults
						? t("components.schedulePage.firstRunSafeDemoTitle")
						: ""
				}
				initialDescription={
					useSafeDemoDefaults
						? t("components.schedulePage.firstRunSafeDemoDescription")
						: ""
				}
				initialAutoPlanGenerationEnabled={useSafeDemoDefaults ? true : undefined}
				initialAutoExecute={useSafeDemoDefaults ? false : undefined}
				allowGoalMode
				isOpen={showCreateTaskDialog}
				initialStartAt={taskDialogDefaults.initialStartAt}
				initialEndAt={taskDialogDefaults.initialEndAt}
				isPending={isCreatingTask}
				availableAiClients={taskCreateConfig.availableAiClients}
				onClose={() => {
					setShowCreateTaskDialog(false);
					setUseSafeDemoDefaults(false);
				}}
				onSubmit={async (input) => {
					try {
						setIsCreatingTask(true);
						if (input.mode === "goal") {
							const created = await createGoalWithFirstTask({
								workspaceId: _defaultWorkspace.id,
								title: input.goalTitle!,
								firstTaskTitle: input.firstTaskTitle!,
								additionalContext: input.description || null,
								priority: input.priority,
								idempotencyKey: uuidv4(),
							});
							setCreatedOnboardingTaskId(created.taskId);
							await revalidate();
							void navigate(localizeHref(locale, `/goals/${created.goal.id}`));
							return;
						}
						const created = await createScheduledTask({
							workspaceId: _defaultWorkspace.id,
							title: input.title,
							description: input.description || null,
							priority: input.priority,
							autoPlanGeneration: input.autoPlanGenerationEnabled || input.autoExecute,
							autoExecute: input.autoExecute,
							autoPlanGenerationTiming: input.autoPlanGenerationTiming,
							autoExecuteTiming: input.autoExecuteTiming,
							executionConfig: {},
							aiClientId: input.aiClientId,
							dueAt: input.dueAt,
							scheduledStartAt: input.scheduledStartAt,
							scheduledEndAt: input.scheduledEndAt,
							recurrenceRule: input.recurrenceRule,
							recurrenceAnchorStartAt: input.recurrenceAnchorStartAt,
							recurrenceAnchorEndAt: input.recurrenceAnchorEndAt,
						});
						if (typeof created.taskId === "string") {
							setCreatedOnboardingTaskId(created.taskId);
							if (
								hasEnabledPlanningClient(taskCreateConfig) &&
								(input.autoPlanGenerationEnabled || input.autoExecute)
							) {
								// Creation already succeeded. Keep the task usable if command
								// dispatch is interrupted; its workspace still exposes Generate.
								await requestInitialTaskPlan(created.taskId).catch(() => undefined);
							}
						}
						revalidate();
					} finally {
						setIsCreatingTask(false);
					}
				}}
			/>
		</SidebarProvider>
	);
}
