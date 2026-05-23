/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appSettings from "../appSettings.js";
import type * as evaluators from "../evaluators.js";
import type * as postings from "../postings.js";
import type * as ranking from "../ranking.js";
import type * as rankingLlmCatalog from "../rankingLlmCatalog.js";
import type * as rankingScorePosting from "../rankingScorePosting.js";
import type * as runLogs from "../runLogs.js";
import type * as runs from "../runs.js";
import type * as sourceContract from "../sourceContract.js";
import type * as sourcePresets from "../sourcePresets.js";
import type * as sources from "../sources.js";
import type * as workerScheduler from "../workerScheduler.js";
import type * as workerSettingsEnv from "../workerSettingsEnv.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appSettings: typeof appSettings;
  evaluators: typeof evaluators;
  postings: typeof postings;
  ranking: typeof ranking;
  rankingLlmCatalog: typeof rankingLlmCatalog;
  rankingScorePosting: typeof rankingScorePosting;
  runLogs: typeof runLogs;
  runs: typeof runs;
  sourceContract: typeof sourceContract;
  sourcePresets: typeof sourcePresets;
  sources: typeof sources;
  workerScheduler: typeof workerScheduler;
  workerSettingsEnv: typeof workerSettingsEnv;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
