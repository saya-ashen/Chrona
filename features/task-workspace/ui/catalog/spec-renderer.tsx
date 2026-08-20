import { useMemo, type ReactNode } from "react";
import { JSONUIProvider, Renderer, type StateStore } from "@json-render/react";
import {
	CATALOG_VERSION,
	isCatalogCompatible,
	type UiDocument,
} from "@chrona/ui-protocol";
import {
	ResultCollapseProvider,
	workspaceRegistry,
	type ResultCollapseCommand,
} from "./workspace-registry";

/**
 * json-render stores a document as a flat element map, but its `children`
 * references still describe a tree. Older/generated result specs can contain
 * both a section and one of its descendants in the same child list. Keep the
 * first real tree path so the same result block is never mounted twice.
 */
export function normalizeSpecTree(spec: UiDocument): UiDocument {
	const root = spec.elements[spec.root];
	if (!root) return spec;

	const elements = spec.elements;
	const directChildren = Array.isArray(root.children)
		? root.children.filter((key): key is string => typeof key === "string")
		: [];
	if (directChildren.length === 0) return spec;

	const collectDescendants = (
		key: string,
		seen = new Set<string>(),
	): Set<string> => {
		if (seen.has(key)) return new Set();
		seen.add(key);
		const descendants = new Set<string>();
		for (const child of elements[key]?.children ?? []) {
			if (typeof child !== "string") continue;
			descendants.add(child);
			for (const descendant of collectDescendants(child, new Set(seen))) {
				descendants.add(descendant);
			}
		}
		return descendants;
	};

	const descendantSets = directChildren.map((key) => collectDescendants(key));
	const topLevelChildren = directChildren.filter((key, index) => {
		if (!elements[key] || directChildren.indexOf(key) !== index) return false;
		return !descendantSets.some(
			(descendants, otherIndex) => otherIndex !== index && descendants.has(key),
		);
	});

	const visited = new Set<string>([spec.root]);
	const normalizedElements = { ...elements };
	let changed = topLevelChildren.length !== directChildren.length;

	const visit = (key: string, ancestry: Set<string>) => {
		const element = elements[key];
		if (!element) return;
		const children = Array.isArray(element.children)
			? element.children.filter(
					(child): child is string => typeof child === "string",
				)
			: [];
		const nextChildren: string[] = [];
		for (const child of children) {
			if (ancestry.has(child) || visited.has(child) || !elements[child]) {
				changed = true;
				continue;
			}
			visited.add(child);
			nextChildren.push(child);
			visit(child, new Set([...ancestry, child]));
		}
		if (
			nextChildren.length !== children.length ||
			(Array.isArray(element.children) &&
				element.children.some((child) => typeof child !== "string"))
		) {
			normalizedElements[key] = { ...element, children: nextChildren };
		}
	};

	visit(spec.root, new Set([spec.root]));
	if (changed) {
		normalizedElements[spec.root] = {
			...normalizedElements[spec.root],
			children: topLevelChildren,
		};
	}

	return changed ? { ...spec, elements: normalizedElements } : spec;
}

function resultBranchKeys(
	key: string,
	elements: UiDocument["elements"],
	seen = new Set<string>(),
): string[] {
	if (seen.has(key)) return [];
	seen.add(key);
	const element = elements[key];
	if (!element) return [];
	return [
		key,
		...(element.children ?? []).flatMap((child) =>
			resultBranchKeys(child, elements, new Set(seen)),
		),
	];
}

function normalizeMetricValue(value: string): string {
	const normalized = value.toLowerCase().replace(/,/g, "").trim();
	const ratio = normalized.match(/\d+(?:\/\d+)?/u)?.[0];
	return ratio ?? normalized;
}

function sourceKeysForBranch(
	key: string,
	elements: UiDocument["elements"],
): Set<string> {
	return new Set(
		resultBranchKeys(key, elements).flatMap((branchKey) => {
			const sourceKeys = elements[branchKey]?.props.sourceKeys;
			return Array.isArray(sourceKeys)
				? sourceKeys.filter(
						(sourceKey): sourceKey is string => typeof sourceKey === "string",
					)
				: [];
		}),
	);
}

function metricValues(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((metric) =>
			typeof metric === "object" && metric !== null && "value" in metric
				? metric.value
				: undefined,
		)
		.filter((item): item is string => typeof item === "string")
		.map(normalizeMetricValue);
}

function matchingMetricValueCount(items: unknown[], values: string[]): number {
	return items.filter(
		(item) =>
			typeof item === "object" &&
			item !== null &&
			"value" in item &&
			values.includes(normalizeMetricValue(String(item.value))),
	).length;
}

function sourceKeyValues(props: Record<string, unknown>): string[] {
	return Array.isArray(props.sourceKeys)
		? props.sourceKeys.filter(
				(sourceKey): sourceKey is string => typeof sourceKey === "string",
			)
		: [];
}

function hasRedundantMetricValues(
	grid: Record<string, unknown>,
	overview: Record<string, unknown>,
): boolean {
	const gridItems = Array.isArray(grid.items) ? grid.items : [];
	const overviewValues = metricValues(overview.metrics);
	if (gridItems.length < 3 || overviewValues.length === 0) return false;
	const matchingValues = matchingMetricValueCount(gridItems, overviewValues);
	return matchingValues >= 3 && matchingValues / gridItems.length >= 0.75;
}

function isRedundantMetricGrid(
	key: string,
	overviewKey: string | undefined,
	elements: UiDocument["elements"],
): boolean {
	if (!overviewKey || elements[key]?.type !== "ResultMetricGrid") return false;
	const grid = elements[key]?.props;
	const overview = elements[overviewKey]?.props;
	if (!grid || !overview) return false;
	const overviewSourceKeys = sourceKeysForBranch(overviewKey, elements);
	const sharesProvenance = sourceKeyValues(grid).some((sourceKey) =>
		overviewSourceKeys.has(sourceKey),
	);
	return sharesProvenance && hasRedundantMetricValues(grid, overview);
}

function applyResultSectionPresentation(
	key: string,
	elements: UiDocument["elements"],
	optimizedElements: UiDocument["elements"],
): boolean {
	const element = elements[key];
	if (!element || element.type !== "ResultSection") return false;
	const branchTypes = new Set(
		resultBranchKeys(key, elements)
			.map((branchKey) => elements[branchKey]?.type)
			.filter((type) => type !== "ResultSection"),
	);
	const compact =
		branchTypes.size > 0 &&
		[...branchTypes].every(
			(type) =>
				type === "ResultComparison" ||
				type === "ResultChecklist" ||
				type === "ResultMetricGrid",
		) &&
		element.props.density === undefined;
	const collapsed =
		branchTypes.size > 0 &&
		[...branchTypes].every((type) => type === "ResultInsight") &&
		element.props.defaultCollapsed !== true;
	if (!compact && !collapsed) return false;
	optimizedElements[key] = {
		...element,
		props: {
			...element.props,
			...(compact ? { density: "compact" } : {}),
			...(collapsed ? { defaultCollapsed: true } : {}),
		},
	};
	return true;
}

/**
 * Preserve Finalizer composition order. Runtime presentation may remove proven
 * duplicate metrics or tighten section density, but must not rewrite hierarchy.
 */
export function prioritizeResultSpec(spec: UiDocument): UiDocument {
	const normalized = normalizeSpecTree(spec);
	const root = normalized.elements[normalized.root];
	if (!root?.children || root.children.length < 2) return normalized;
	const children = [...root.children];
	const overviewKey = children.find(
		(key) => normalized.elements[key]?.type === "ResultOverview",
	);
	const visibleOrdered = children.filter(
		(key) => !isRedundantMetricGrid(key, overviewKey, normalized.elements),
	);
	const optimizedElements = { ...normalized.elements };
	let changed =
		visibleOrdered.length !== children.length ||
		!visibleOrdered.every((key, index) => key === children[index]);
	for (const key of visibleOrdered) {
		changed =
			applyResultSectionPresentation(
				key,
				normalized.elements,
				optimizedElements,
			) || changed;
	}
	if (!changed) return normalized;
	return {
		...normalized,
		elements: {
			...optimizedElements,
			[normalized.root]: { ...root, children: visibleOrdered },
		},
	};
}

/**
 * Falls back to the supplied typed renderer when there is no spec, or when the
 * spec was produced against an incompatible catalog major version (plan §4.3,
 * §7). Invalid specs are rejected upstream by `validateChronaSpec`; this guards
 * the render path itself.
 */
export function SpecRenderer({
	spec,
	catalogVersion = CATALOG_VERSION,
	loading,
	fallback,
	handlers,
	onStateChange,
	store,
	resultCollapseCommand,
	resultCollapseStorageKey,
	resultPresentation = false,
}: {
	spec: UiDocument | null | undefined;
	catalogVersion?: string;
	loading?: boolean;
	fallback?: ReactNode;
	/** Per-render action handlers forwarded to JSONUIProvider (plan §6). */
	handlers?: Record<
		string,
		(params: Record<string, unknown>) => Promise<unknown> | unknown
	>;
	/** State-change notifications from JSONUIProvider (path/value pairs). */
	onStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
	store?: StateStore;
	resultCollapseCommand?: ResultCollapseCommand | null;
	resultCollapseStorageKey?: string | null;
	resultPresentation?: boolean;
}) {
	const normalizedSpec = useMemo(
		() =>
			spec
				? resultPresentation
					? prioritizeResultSpec(spec)
					: normalizeSpecTree(spec)
				: spec,
		[resultPresentation, spec],
	);
	const keyedSpec = useMemo(() => {
		if (!normalizedSpec?.elements) return normalizedSpec;
		return {
			...normalizedSpec,
			elements: Object.fromEntries(
				Object.entries(normalizedSpec.elements).map(([key, element]) => [
					key,
					{
						...element,
						props: { ...element.props, __chronaCollapseStorageId: key },
					},
				]),
			),
		};
	}, [normalizedSpec]);

	if (!normalizedSpec || !isCatalogCompatible(catalogVersion)) {
		return <>{fallback}</>;
	}

	const renderSpec = keyedSpec ?? normalizedSpec;

	return (
		<ResultCollapseProvider
			command={resultCollapseCommand}
			storageKey={resultCollapseStorageKey}
		>
			<JSONUIProvider
				registry={workspaceRegistry}
				store={store}
				initialState={renderSpec.state}
				handlers={handlers}
				onStateChange={onStateChange}
			>
				<Renderer
					spec={renderSpec}
					registry={workspaceRegistry}
					loading={loading}
				/>
			</JSONUIProvider>
		</ResultCollapseProvider>
	);
}
