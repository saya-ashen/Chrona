import type { Spec } from "@json-render/core";
import type { chronaCatalog } from "../catalog/components";

/**
 * A Chrona UI document is a json-render {@link Spec} produced against
 * {@link chronaCatalog}. `Spec` is the library's flat element-tree format
 * (`{ root, elements, state? }`); `ChronaSpec` is that format narrowed to the
 * Chrona catalog's component/prop types.
 */
export type { Spec } from "@json-render/core";

export type ChronaSpec = (typeof chronaCatalog)["_specType"];

/** Looser alias for call sites that only need the structural Spec shape. */
export type UiDocument = Spec;
