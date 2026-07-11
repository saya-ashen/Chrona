/**
 * @chrona/omp — Oh My Pi execution provider.
 *
 * Uses the in-process OMP SDK for every Chrona OMP run.
 */

export const CHRONA_OMP_PROVIDER_TYPE = "omp";

export {
  OmpProviderClient,
  type OmpProviderOptions,
} from "./OmpProviderClient";
export { OmpSdkProviderClient, type OmpSdkProviderOptions } from "./OmpSdkProviderClient";

export { type OmpProviderConfig } from "./types";
