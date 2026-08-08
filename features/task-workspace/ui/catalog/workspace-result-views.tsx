import { cn } from "@shared/ui";
import { Check, Circle } from "lucide-react";
import {
	recordProp,
	stringField,
	stringProp,
} from "./workspace-registry-utilities";

export function ResultComparison({
	props,
}: {
	props: Record<string, unknown>;
}) {
	const columns = Array.isArray(props.columns)
		? props.columns.filter(
				(item): item is { key: string; label: string } =>
					stringField(item, "key") !== undefined &&
					stringField(item, "label") !== undefined,
			)
		: [];
	const rows = Array.isArray(props.rows)
		? props.rows.filter(
				(
					item,
				): item is {
					label: string;
					values: Record<string, string>;
					emphasis?: string;
				} => {
					const record = recordProp(item);
					return (
						stringField(item, "label") !== undefined &&
						recordProp(record?.values) !== null
					);
				},
			)
		: [];
	return (
		<section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background">
			<div className="p-4 sm:p-5">
				<h3 className="font-heading text-base font-semibold">
					{stringProp(props.title) ?? "Comparison"}
				</h3>
				{typeof props.summary === "string" ? (
					<p className="mt-1 text-sm text-muted-foreground">{props.summary}</p>
				) : null}
			</div>
			<div
				className="overflow-x-auto"
				tabIndex={0}
				role="region"
				aria-label={`${stringProp(props.title) ?? "Comparison"} table`}
			>
				<table className="w-full min-w-[40rem] border-collapse text-left text-sm">
					<thead>
						<tr className="border-y border-border/60 bg-muted/35">
							<th scope="col" className="px-4 py-3 font-semibold">
								Rank
							</th>
							{columns.map((column) => (
								<th key={column.key} className="px-4 py-3 font-semibold">
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={row.label}
								className={cn(
									"border-b border-border/50 last:border-b-0",
									row.emphasis === "recommended" && "bg-success/5",
									row.emphasis === "warning" && "bg-warning/5",
									row.emphasis === "muted" && "text-muted-foreground",
								)}
							>
								<th className="px-4 py-3 font-medium">{row.label}</th>
								{columns.map((column) => (
									<td
										key={column.key}
										className="px-4 py-3 align-top leading-5"
									>
										{row.values[column.key] ?? "—"}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

export function ResultTimeline({ props }: { props: Record<string, unknown> }) {
	const items = Array.isArray(props.items)
		? props.items.filter(
				(
					item,
				): item is {
					label: string;
					title: string;
					summary?: string;
					status?: string;
				} =>
					stringField(item, "label") !== undefined &&
					stringField(item, "title") !== undefined,
			)
		: [];
	return (
		<section className="min-w-0">
			<h3 className="font-heading text-base font-semibold">
				{stringProp(props.title) ?? "Timeline"}
			</h3>
			{typeof props.summary === "string" ? (
				<p className="mt-1 text-sm text-muted-foreground">{props.summary}</p>
			) : null}
			<ol className="mt-4 space-y-0">
				{items.map((item, index) => (
					<li
						key={`${item.label}:${item.title}`}
						className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
					>
						<span
							className={cn(
								"mt-1 size-3 rounded-full border-2 bg-background",
								item.status === "completed" && "border-success bg-success",
								item.status === "current" && "border-primary bg-primary",
								item.status === "blocked" &&
									"border-destructive bg-destructive",
								(!item.status || item.status === "upcoming") && "border-border",
							)}
						/>
						{index < items.length - 1 ? (
							<span className="absolute left-[0.34rem] top-4 h-[calc(100%-0.5rem)] w-px bg-border" />
						) : null}
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
								{item.label}
							</p>
							<p className="mt-0.5 text-sm font-semibold text-foreground">
								{item.title}
							</p>
							{item.summary ? (
								<p className="mt-1 text-sm leading-5 text-muted-foreground">
									{item.summary}
								</p>
							) : null}
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}

export function ResultChecklist({ props }: { props: Record<string, unknown> }) {
	const items = Array.isArray(props.items)
		? props.items.filter(
				(
					item,
				): item is {
					label: string;
					detail?: string;
					status: string;
					statusLabel?: string;
				} =>
					stringField(item, "label") !== undefined &&
					stringField(item, "status") !== undefined,
			)
		: [];
	return (
		<section className="min-w-0 rounded-2xl border border-border/60 bg-background p-4 sm:p-5">
			<h3 className="font-heading text-base font-semibold">
				{stringProp(props.title) ?? "Checklist"}
			</h3>
			{typeof props.summary === "string" ? (
				<p className="mt-1 text-sm text-muted-foreground">{props.summary}</p>
			) : null}
			<ul className="mt-4 divide-y divide-border/50">
				{items.map((item) => (
					<li
						key={`${item.status}:${item.label}`}
						className="flex gap-3 py-3 first:pt-0 last:pb-0"
					>
						<span
							className={cn(
								"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
								item.status === "done" &&
									"border-success bg-success text-success-foreground",
								item.status === "blocked" &&
									"border-destructive text-destructive",
								item.status === "in_progress" && "border-primary text-primary",
							)}
						>
							{item.status === "done" ? (
								<Check className="size-3" />
							) : (
								<Circle className="size-2.5" />
							)}
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<p className="text-sm font-medium">{item.label}</p>
								{item.statusLabel ? (
									<span className="text-xs text-muted-foreground">
										{item.statusLabel}
									</span>
								) : null}
							</div>
							{item.detail ? (
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									{item.detail}
								</p>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

export function ResultChangeSummary({
	props,
}: {
	props: Record<string, unknown>;
}) {
	const items = Array.isArray(props.items)
		? props.items.filter(
				(
					item,
				): item is {
					path: string;
					summary: string;
					status: string;
					validation?: string;
				} =>
					stringField(item, "path") !== undefined &&
					stringField(item, "summary") !== undefined &&
					stringField(item, "status") !== undefined,
			)
		: [];
	return (
		<section className="min-w-0 rounded-2xl border border-border/70 bg-background p-4 sm:p-5">
			<h3 className="font-heading text-base font-semibold">
				{stringProp(props.title) ?? "Changes"}
			</h3>
			{typeof props.summary === "string" ? (
				<p className="mt-1 text-sm text-muted-foreground">{props.summary}</p>
			) : null}
			<ul className="mt-4 divide-y divide-border/50">
				{items.map((item) => (
					<li
						key={`${item.status}:${item.path}`}
						className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] sm:gap-4"
					>
						<code className="break-all text-xs font-semibold text-foreground">
							{item.path}
						</code>
						<div>
							<p className="text-sm leading-5 text-foreground/85">
								{item.summary}
							</p>
							{item.validation ? (
								<p className="mt-1 text-xs text-muted-foreground">
									{item.validation}
								</p>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
