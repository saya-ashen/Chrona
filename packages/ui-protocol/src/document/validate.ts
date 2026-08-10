import { validateSpec as coreValidateSpec, type Spec } from "@json-render/core";
import type { ZodType } from "zod";
import { UI_ACTION_PAYLOAD } from "../actions/actions";
import { chronaCatalog } from "../catalog/components";
import type { ChronaSpec } from "./document";

export interface ValidationIssue {
	path: string;
	message: string;
}

export type ValidateResult =
	| { ok: true; spec: ChronaSpec }
	| { ok: false; issues: ValidationIssue[] };

function isSpecLike(value: unknown): value is Spec {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.root === "string" &&
		typeof candidate.elements === "object" &&
		candidate.elements !== null
	);
}

const COMPONENT_TYPE_ALIASES: Record<string, string> = {
	heading: "heading",
	paragraph: "paragraph",
	table: "table",
	section: "section",
};

/**
 * True when `value` is a json-render dynamic expression object (`$state`,
 * `$item`, `$template`, etc.). Such props carry no literal value at submission
 * time — they are resolved against the state model at render time — so the
 * catalog's per-component Zod prop types must not be applied to them.
 *
 * Mirrors the expression detectors in `@json-render/core` (which are not
 * exported). The catalog prompt actively teaches the AI to use these, so the
 * validator must accept them everywhere a literal value is otherwise expected.
 */
const STRING_EXPRESSION_KEYS = [
	"$state",
	"$item",
	"$bindState",
	"$bindItem",
	"$template",
	"$computed",
] as const;

function isDynamicExpression(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	if (v.$index === true) return true;
	if ("$cond" in v && "$then" in v && "$else" in v) return true;
	return STRING_EXPRESSION_KEYS.some((key) => typeof v[key] === "string");
}

/**
 * Recursively drop dynamic expressions from a props value so that only literal
 * parts are type-checked. Expression nodes become absent (object keys removed,
 * array entries filtered), which `.partial()` then treats as optional. Literal
 * siblings stay strictly validated, so genuine type errors (e.g. an invalid
 * `gap` enum value) are still rejected.
 */
function stripDynamicExpressions(value: unknown): unknown {
	if (isDynamicExpression(value)) return undefined;
	if (Array.isArray(value)) {
		return value
			.map(stripDynamicExpressions)
			.filter((entry) => entry !== undefined);
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			const stripped = stripDynamicExpressions(entry);
			if (stripped !== undefined) out[key] = stripped;
		}
		return out;
	}
	return value;
}

function normalizeElement(element: Spec["elements"][string]) {
	const type = COMPONENT_TYPE_ALIASES[element.type] ?? element.type;
	return type === element.type ? element : { ...element, type };
}

export function normalizeChronaSpec(input: unknown): Spec {
	if (!isSpecLike(input)) return input as Spec;
	const elements = Object.fromEntries(
		Object.entries(input.elements).map(([key, element]) => [
			key,
			normalizeElement(element),
		]),
	) as Spec["elements"];

	if (elements[input.root]) {
		return elements === input.elements ? input : { ...input, elements };
	}

	const childKeys = Object.keys(elements);
	if (childKeys.length === 0) return { ...input, elements };
	return {
		...input,
		root: input.root,
		elements: {
			...elements,
			[input.root]: {
				type: "Stack",
				props: { gap: "md" },
				children: childKeys,
			},
		},
	};
}

/**
 * Strictly validate an unknown value as a Chrona UI document:
 *  1. structural shape (`{ root, elements }`);
 *  2. every element's `type` is a known catalog component, and its `props`
 *     satisfy that component's Zod schema (validated directly against the
 *     catalog — `catalog.validate()` is intentionally lenient for streaming);
 *  3. reference integrity via core `validateSpec` (root/children resolve, no
 *     orphans).
 *
 * Producers that fail validation fall back to typed rendering (plan §7). The
 * AI Node-result path MUST call this before persisting (plan §5.1).
 */

function validateChildCycles(spec: Spec, issues: ValidationIssue[]) {
	const visiting = new Set<string>();
	const visited = new Set<string>();

	function visit(key: string, path: string[]) {
		if (visiting.has(key)) {
			issues.push({
				path: `elements.${key}.children`,
				message: `cycle detected: ${[...path, key].join(" -> ")}`,
			});
			return;
		}
		if (visited.has(key)) return;
		const element = spec.elements[key];
		if (!element) return;
		visiting.add(key);
		for (const child of element.children ?? []) visit(child, [...path, key]);
		visiting.delete(key);
		visited.add(key);
	}

	visit(spec.root, []);
}

function validateRepeatedRootDescendants(
	spec: Spec,
	issues: ValidationIssue[],
	enabled: boolean,
) {
	if (!enabled) return;
	const root = spec.elements[spec.root];
	if (!root) return;
	const directChildren = root.children ?? [];
	const descendantsOf = (
		key: string,
		seen = new Set<string>(),
	): Set<string> => {
		if (seen.has(key)) return new Set();
		seen.add(key);
		const descendants = new Set<string>();
		for (const child of spec.elements[key]?.children ?? []) {
			descendants.add(child);
			for (const descendant of descendantsOf(child, new Set(seen))) {
				descendants.add(descendant);
			}
		}
		return descendants;
	};
	const descendantSets = directChildren.map((key) => descendantsOf(key));
	for (const [index, key] of directChildren.entries()) {
		if (
			directChildren.indexOf(key) !== index ||
			descendantSets.some(
				(descendants, otherIndex) =>
					otherIndex !== index && descendants.has(key),
			)
		) {
			issues.push({
				path: `elements.${spec.root}.children`,
				message: `element "${key}" is referenced more than once in the rendered tree; keep descendants under their parent only`,
			});
		}
	}
}

function validateActionBindings(
	elementKey: string,
	element: Spec["elements"][string],
	issues: ValidationIssue[],
) {
	const handlers = (element as { on?: unknown }).on;
	if (!handlers || typeof handlers !== "object" || Array.isArray(handlers))
		return;

	for (const [eventName, binding] of Object.entries(handlers)) {
		if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
			issues.push({
				path: `elements.${elementKey}.on.${eventName}`,
				message: "action binding must be an object",
			});
			continue;
		}
		const action = (binding as { action?: unknown }).action;
		const params = (binding as { params?: unknown }).params;
		if (typeof action !== "string") {
			issues.push({
				path: `elements.${elementKey}.on.${eventName}.action`,
				message: "action binding action must be a string",
			});
			continue;
		}
		const paramsSchema =
			UI_ACTION_PAYLOAD[action as keyof typeof UI_ACTION_PAYLOAD];
		if (!paramsSchema) continue;
		const paramsResult = paramsSchema.safeParse(
			stripDynamicExpressions(params),
		);
		if (!paramsResult.success) {
			for (const issue of paramsResult.error.issues) {
				issues.push({
					path: `elements.${elementKey}.on.${eventName}.params.${issue.path.join(".")}`,
					message: issue.message,
				});
			}
		}
	}
}
export function validateChronaSpec(input: unknown): ValidateResult {
	if (!isSpecLike(input)) {
		return {
			ok: false,
			issues: [{ path: "", message: "not a spec ({ root, elements })" }],
		};
	}

	const hasDeclaredRoot = Boolean(input.elements[input.root]);
	const spec = normalizeChronaSpec(input);
	const issues: ValidationIssue[] = [];
	const components = chronaCatalog.data.components as Record<
		string,
		{ props: ZodType }
	>;

	for (const [key, element] of Object.entries(spec.elements)) {
		const definition = components[element.type];
		if (!definition) {
			issues.push({
				path: `elements.${key}.type`,
				message: `unknown component "${element.type}"`,
			});
			continue;
		}

		// Presence-lenient, type-strict: relax required props (shadcn declares
		// optionals as `.nullable()` required keys) so omitting a prop is fine,
		// while a present prop with the wrong type is still rejected. Dynamic
		// json-render expressions ($state/$item/$template/…) carry no literal
		// value at submission time, so strip them first — otherwise a legitimate
		// `{ "$item": "url" }` on a string prop is wrongly rejected as
		// "expected string, received object".
		const propsSchema = definition.props as ZodType & {
			partial?: () => ZodType;
		};
		const validator =
			typeof propsSchema.partial === "function"
				? propsSchema.partial()
				: propsSchema;
		const rawProps = (element as { props?: unknown }).props ?? {};
		const propsResult = validator.safeParse(stripDynamicExpressions(rawProps));
		if (!propsResult.success) {
			for (const issue of propsResult.error.issues) {
				issues.push({
					path: `elements.${key}.props.${issue.path.join(".")}`,
					message: issue.message,
				});
			}
		}

		validateActionBindings(key, element, issues);
	}

	validateChildCycles(spec, issues);
	validateRepeatedRootDescendants(spec, issues, hasDeclaredRoot);

	for (const issue of coreValidateSpec(spec).issues) {
		if (issue.severity === "error") {
			issues.push({
				path: issue.elementKey ?? "root",
				message: `${issue.code}: ${issue.message}`,
			});
		}
	}

	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, spec: spec as ChronaSpec };
}
