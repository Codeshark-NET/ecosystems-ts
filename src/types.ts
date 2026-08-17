/**
 * Model types re-exported from the generated schemas.
 *
 * Nothing here is hand-written -- these are aliases so callers import `Package` rather
 * than `components["schemas"]["Package"]`. The generated files remain available for the
 * many endpoints this SDK does not wrap.
 *
 * Note on dates: `format: date-time` fields are typed `string`, not `Date`. Go parses
 * them into `time.Time`; we leave them as the ISO 8601 strings the API sends, so no
 * information is lost and no timezone assumptions are baked in.
 */

import type { components as AdvisoriesComponents } from "./generated/advisories.js";
import type { components as CommitsComponents } from "./generated/commits.js";
import type { components as IssuesComponents } from "./generated/issues.js";
import type { components as PackagesComponents } from "./generated/packages.js";
import type { components as ReposComponents } from "./generated/repos.js";

// -- packages.ecosyste.ms ----------------------------------------------------
export type Registry = PackagesComponents["schemas"]["Registry"];
export type Package = PackagesComponents["schemas"]["Package"];
export type PackageWithRegistry = PackagesComponents["schemas"]["PackageWithRegistry"];
export type Version = PackagesComponents["schemas"]["Version"];
export type VersionWithDependencies = PackagesComponents["schemas"]["VersionWithDependencies"];
export type Dependency = PackagesComponents["schemas"]["Dependency"];
export type Maintainer = PackagesComponents["schemas"]["Maintainer"];

// -- repos.ecosyste.ms ------------------------------------------------------
export type Repository = ReposComponents["schemas"]["Repository"];
export type Host = ReposComponents["schemas"]["Host"];

// -- advisories.ecosyste.ms -------------------------------------------------
export type Advisory = AdvisoriesComponents["schemas"]["Advisory"];

// -- commits.ecosyste.ms / issues.ecosyste.ms -------------------------------
// Both services expose a `Repository` schema of their own; named for the accessor that
// returns them to avoid three clashing `Repository` types.
export type CommitsSummary = CommitsComponents["schemas"]["Repository"];
export type IssuesSummary = IssuesComponents["schemas"]["Repository"];
