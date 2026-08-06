import { useState } from "react";
import {
	CalendarDays,
	LayoutList,
	Clock,
	ChevronLeft,
	ChevronRight,
} from "lucide-react";
import {
	Button,
	Calendar,
	Popover,
	PopoverContent,
	PopoverTrigger,
	PageHeader,
} from "@shared/ui";

type PlanningDayLink = {
	label: string;
	href: string;
	kind: "previous" | "today" | "next";
	current?: boolean;
};

export function PlanningHeader({
	ariaLabel,
	title,
	activeDayLabel,
	summary,
	dayLinks,
	selectedDate,
	onSelectDate,
	primaryAction,
	activeView,
	timelineHref,
	listHref,
	timelineLabel,
	listLabel,
	onNavigate,
}: {
	ariaLabel: string;
	title: string;
	activeDayLabel: string;
	summary: string;
	dayLinks: PlanningDayLink[];
	selectedDate: Date;
	onSelectDate: (date: Date) => void;
	primaryAction: { label: string; onClick: () => void };
	activeView: "timeline" | "list";
	timelineHref: string;
	listHref: string;
	timelineLabel: string;
	listLabel: string;
	onNavigate?: (href: string) => void;
}) {
	const [datePickerOpen, setDatePickerOpen] = useState(false);
	const previousDay = dayLinks.find((link) => link.kind === "previous");
	const today = dayLinks.find((link) => link.kind === "today");
	const nextDay = dayLinks.find((link) => link.kind === "next");

	return (
		<PageHeader
			data-testid="planning-header"
			role="region"
			aria-label={ariaLabel}
			title={title}
			description={summary}
			toolbar={
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex min-w-0 items-center gap-0.5">
						{previousDay ? (
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								aria-label={previousDay.label}
								onClick={() => onNavigate?.(previousDay.href)}
							>
								<ChevronLeft />
							</Button>
						) : null}
						<h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
							{activeDayLabel}
						</h2>
						<Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									aria-label={activeDayLabel}
								>
									<CalendarDays aria-hidden="true" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="start"
								className="z-50 w-auto border bg-popover p-0 text-popover-foreground shadow-lg"
							>
								<Calendar
									mode="single"
									selected={selectedDate}
									defaultMonth={selectedDate}
									onSelect={(date) => {
										if (!date) return;
										setDatePickerOpen(false);
										onSelectDate(date);
									}}
								/>
							</PopoverContent>
						</Popover>
						{nextDay ? (
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								aria-label={nextDay.label}
								onClick={() => onNavigate?.(nextDay.href)}
							>
								<ChevronRight />
							</Button>
						) : null}
						{today ? (
							<Button
								type="button"
								size="sm"
								className="hidden sm:inline-flex"
								variant={today.current ? "secondary" : "outline"}
								aria-current={today.current ? "date" : undefined}
								onClick={() => onNavigate?.(today.href)}
							>
								{today.label}
							</Button>
						) : null}
					</div>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<div
							className="grid grid-cols-2 rounded-md border border-border bg-surface-soft p-0.5"
							aria-label={`${ariaLabel} view`}
							role="group"
						>
							<Button
								type="button"
								size="sm"
								variant={activeView === "timeline" ? "secondary" : "ghost"}
								aria-current={activeView === "timeline" ? "page" : undefined}
								onClick={() => onNavigate?.(timelineHref)}
							>
								<Clock />
								{timelineLabel}
							</Button>
							<Button
								type="button"
								size="sm"
								variant={activeView === "list" ? "secondary" : "ghost"}
								aria-current={activeView === "list" ? "page" : undefined}
								onClick={() => onNavigate?.(listHref)}
							>
								<LayoutList />
								{listLabel}
							</Button>
						</div>
						<Button type="button" onClick={primaryAction.onClick}>
							{primaryAction.label}
						</Button>
					</div>
				</div>
			}
		/>
	);
}
