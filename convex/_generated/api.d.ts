/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as apiStores from "../apiStores.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as forge_accounts from "../forge/accounts.js";
import type * as forge_automations from "../forge/automations.js";
import type * as forge_changes from "../forge/changes.js";
import type * as forge_events from "../forge/events.js";
import type * as forge_extras from "../forge/extras.js";
import type * as forge_fanout from "../forge/fanout.js";
import type * as forge_health from "../forge/health.js";
import type * as forge_insights from "../forge/insights.js";
import type * as forge_integrations from "../forge/integrations.js";
import type * as forge_issues from "../forge/issues.js";
import type * as forge_live from "../forge/live.js";
import type * as forge_notifications from "../forge/notifications.js";
import type * as forge_oauth from "../forge/oauth.js";
import type * as forge_people from "../forge/people.js";
import type * as forge_pipelines from "../forge/pipelines.js";
import type * as forge_policy from "../forge/policy.js";
import type * as forge_pushes from "../forge/pushes.js";
import type * as forge_releases from "../forge/releases.js";
import type * as forge_repos from "../forge/repos.js";
import type * as forge_runs from "../forge/runs.js";
import type * as forge_search from "../forge/search.js";
import type * as forge_stackLanding from "../forge/stackLanding.js";
import type * as forge_sync from "../forge/sync.js";
import type * as forge_teams from "../forge/teams.js";
import type * as forge_tokens from "../forge/tokens.js";
import type * as forge_uploads from "../forge/uploads.js";
import type * as forge_webhooks from "../forge/webhooks.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_acl from "../lib/acl.js";
import type * as lib_actor from "../lib/actor.js";
import type * as lib_changeTypes from "../lib/changeTypes.js";
import type * as lib_changes from "../lib/changes.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_grants from "../lib/grants.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_issues from "../lib/issues.js";
import type * as lib_mail from "../lib/mail.js";
import type * as lib_paginate from "../lib/paginate.js";
import type * as lib_pierre from "../lib/pierre.js";
import type * as lib_present from "../lib/present.js";
import type * as lib_runs from "../lib/runs.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as mail from "../mail.js";
import type * as profiles from "../profiles.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  apiStores: typeof apiStores;
  auth: typeof auth;
  crons: typeof crons;
  "forge/accounts": typeof forge_accounts;
  "forge/automations": typeof forge_automations;
  "forge/changes": typeof forge_changes;
  "forge/events": typeof forge_events;
  "forge/extras": typeof forge_extras;
  "forge/fanout": typeof forge_fanout;
  "forge/health": typeof forge_health;
  "forge/insights": typeof forge_insights;
  "forge/integrations": typeof forge_integrations;
  "forge/issues": typeof forge_issues;
  "forge/live": typeof forge_live;
  "forge/notifications": typeof forge_notifications;
  "forge/oauth": typeof forge_oauth;
  "forge/people": typeof forge_people;
  "forge/pipelines": typeof forge_pipelines;
  "forge/policy": typeof forge_policy;
  "forge/pushes": typeof forge_pushes;
  "forge/releases": typeof forge_releases;
  "forge/repos": typeof forge_repos;
  "forge/runs": typeof forge_runs;
  "forge/search": typeof forge_search;
  "forge/stackLanding": typeof forge_stackLanding;
  "forge/sync": typeof forge_sync;
  "forge/teams": typeof forge_teams;
  "forge/tokens": typeof forge_tokens;
  "forge/uploads": typeof forge_uploads;
  "forge/webhooks": typeof forge_webhooks;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/acl": typeof lib_acl;
  "lib/actor": typeof lib_actor;
  "lib/changeTypes": typeof lib_changeTypes;
  "lib/changes": typeof lib_changes;
  "lib/errors": typeof lib_errors;
  "lib/events": typeof lib_events;
  "lib/functions": typeof lib_functions;
  "lib/grants": typeof lib_grants;
  "lib/input": typeof lib_input;
  "lib/issues": typeof lib_issues;
  "lib/mail": typeof lib_mail;
  "lib/paginate": typeof lib_paginate;
  "lib/pierre": typeof lib_pierre;
  "lib/present": typeof lib_present;
  "lib/runs": typeof lib_runs;
  "lib/time": typeof lib_time;
  "lib/tokens": typeof lib_tokens;
  mail: typeof mail;
  profiles: typeof profiles;
  seed: typeof seed;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
