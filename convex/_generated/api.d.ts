/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as availability from "../availability.js";
import type * as branches from "../branches.js";
import type * as checkout from "../checkout.js";
import type * as http from "../http.js";
import type * as lib_capabilities from "../lib/capabilities.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_index from "../lib/index.js";
import type * as lib_locationLimits from "../lib/locationLimits.js";
import type * as lib_polar from "../lib/polar.js";
import type * as lib_saasAdmin from "../lib/saasAdmin.js";
import type * as lib_tenantContext from "../lib/tenantContext.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_weekUtils from "../lib/weekUtils.js";
import type * as polarWebhooks from "../polarWebhooks.js";
import type * as schedule from "../schedule.js";
import type * as shiftTemplates from "../shiftTemplates.js";
import type * as team from "../team.js";
import type * as tenants from "../tenants.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  availability: typeof availability;
  branches: typeof branches;
  checkout: typeof checkout;
  http: typeof http;
  "lib/capabilities": typeof lib_capabilities;
  "lib/guards": typeof lib_guards;
  "lib/index": typeof lib_index;
  "lib/locationLimits": typeof lib_locationLimits;
  "lib/polar": typeof lib_polar;
  "lib/saasAdmin": typeof lib_saasAdmin;
  "lib/tenantContext": typeof lib_tenantContext;
  "lib/types": typeof lib_types;
  "lib/weekUtils": typeof lib_weekUtils;
  polarWebhooks: typeof polarWebhooks;
  schedule: typeof schedule;
  shiftTemplates: typeof shiftTemplates;
  team: typeof team;
  tenants: typeof tenants;
  users: typeof users;
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
