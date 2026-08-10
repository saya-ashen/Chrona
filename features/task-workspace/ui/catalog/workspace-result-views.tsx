import { cn } from "@shared/ui";
import { Check, Circle } from "lucide-react";
import {
	recordProp,
	stringField,
	stringProp,
} from "./workspace-registry-utilities";
import { safeExternalHref } from "./workspace-table-data";

function ComparisonValue({ value }: { value: string | undefined }) {
	const text = value ?? "—";
	const href = safeExternalHref(text);
	if (!href)
		return <span className="break-words [overflow-wrap:anywhere]">{text}</span>;
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="break-all font-medium text-primary underline-offset-4 hover:underline"
		>
			{text}
		</a>
	);
}

function comparisonRowHeaderLabel(props: Record<string, unknown>) {
	const explicit = stringProp(props.rowHeaderLabel);
	if (explicit) return explicit;
	const title = stringProp(props.title)?.toLowerCase() ?? "";
	if (/筛选|口径/.test(title)) return "维度";
	if (/scope|snapshot/.test(title)) return "Dimension";
	if (/新增|仓库/.test(title)) return "仓库";
	if (/stars|trending|repo/.test(title)) return "Repository";
	return "Item";
}

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
	const rowHeaderLabel = comparisonRowHeaderLabel(props);
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
				<table className="w-full border-collapse text-left text-sm sm:min-w-[40rem] sm:table-fixed">
					<thead className="hidden sm:table-header-group">
						<tr className="border-y border-border/60 bg-muted/35">
							<th scope="col" className="px-4 py-3 font-semibold">
								{rowHeaderLabel}
							</th>
							{columns.map((column) => (
								<th key={column.key} className="px-4 py-3 font-semibold">
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="block space-y-3 p-3 sm:table-row-group sm:space-y-0 sm:p-0">
						{rows.map((row) => (
							<tr
								key={row.label}
								className={cn(
									"block rounded-xl border border-border/60 sm:table-row sm:rounded-none sm:border-x-0 sm:border-t-0",
									row.emphasis === "recommended" && "bg-success/5",
									row.emphasis === "warning" && "bg-warning/5",
									row.emphasis === "muted" && "text-muted-foreground",
								)}
							>
								<th
									scope="row"
									className="block px-3 pb-2 pt-3 font-semibold text-foreground sm:table-cell sm:px-4 sm:py-3 sm:font-medium"
								>
									{row.label}
								</th>
								{columns.map((column) => (
									<td
										key={column.key}
										data-label={column.label}
										className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 px-3 py-2 align-top leading-5 before:text-muted-foreground before:content-[attr(data-label)] last:pb-3 sm:table-cell sm:px-4 sm:py-3 sm:before:content-none"
									>
										<ComparisonValue value={row.values[column.key]} />
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
