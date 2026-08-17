# ecosystems-ts

TypeScript client library for the [ecosyste.ms](https://ecosyste.ms) APIs. See the
[API documentation](https://ecosyste.ms/api) for details.

A port of [ecosystems-go](https://github.com/ecosyste-ms/ecosystems-go), following the
same design decisions wherever they translate. Two runtime dependencies:
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) (6 kB) and
[`packageurl-js`](https://github.com/package-url/packageurl-js).

## Installation

```bash
npm install @ecosyste-ms/ecosystems-ts
```

Requires Node 20+, or any runtime with `fetch` (Deno, Bun, Cloudflare Workers, browsers).

## Usage

```ts
import { EcosystemsClient } from "@ecosyste-ms/ecosystems-ts";

// userAgent is required - identify your application
const client = new EcosystemsClient({ userAgent: "my-app/1.0" });

// Bulk lookup packages by PURL
const results = await client.bulkLookup([
  "pkg:gem/rails",
  "pkg:npm/lodash",
  "pkg:pypi/requests",
]);

for (const [purl, pkg] of results) {
  console.log(`${purl}: ${pkg.name} (${pkg.latest_release_number})`);
}

// Lookup a single package
const pkg = await client.lookup("pkg:gem/rake");
console.log(`rake has ${pkg?.versions_count} versions`);

// Get a specific version
const version = await client.getVersion("rubygems.org", "rake", "13.0.0");
console.log(`rake 13.0.0 integrity: ${version?.integrity}`);

// Get all versions
const versions = await client.getAllVersions("rubygems.org", "rake");
console.log(`rake has ${versions.length} versions`);
```

Lookups that find nothing return `null` (or `[]` for lists) rather than throwing — "not
found" is a normal outcome for a lookup API, not an exception.

## PURL Helpers

```ts
import {
  parsePurl,
  purlToRegistry,
  purlToName,
} from "@ecosyste-ms/ecosystems-ts";

// Parse a PURL string (handles with or without the pkg: prefix)
const purl = parsePurl("gem/rails@7.0.0");

// Convert PURL to an ecosyste.ms registry name
purlToRegistry(purl); // "rubygems.org"

// Convert PURL to the ecosyste.ms package name format
purlToName(purl); // "rails"

// Lookup using a PURL directly
const pkg = await client.lookupPurl(purl);
const version = await client.getVersionPurl(purl);
const versions = await client.getAllVersionsPurl(purl);
```

The API speaks two vocabularies: bulk lookup takes PURLs, but the per-package endpoints
are `/registries/{registry}/packages/{name}` — and a registry name is not a PURL type.
These helpers bridge them. The mapping is a maintained table; `client.listRegistries()`
returns the authoritative list at runtime.

## Repository Metadata

```ts
const repoUrl = "https://github.com/rails/rails";

const repo = await client.getRepository(repoUrl);
const packages = await client.lookupPackagesByRepositoryUrl(repoUrl, 25);
const advisories = await client.getAdvisoriesByRepoUrl(repoUrl, 100);
const commits = await client.getCommitsSummary(repoUrl);
const issues = await client.getIssuesSummary(repoUrl);
const dependents = await client.getDependentPackages("rubygems.org", "rails", 30);
```

List methods follow `Link: rel="next"` pagination and stop at the requested item cap when
one is provided. Without a cap they stop at 20 pages and **throw** rather than silently
returning a short list.

Those methods hold every page in memory. To stream instead, `client.paginate` yields one
page at a time and stops fetching the moment you stop consuming:

```ts
const pages = client.paginate(() =>
  client.packages.GET("/registries/{registryName}/packages/{packageName}/dependent_packages", {
    params: { path: { registryName: "npmjs.org", packageName: "lodash" } },
  }),
);

for await (const page of pages) {
  for (const pkg of page) console.log(pkg.name);
}
```

It takes a thunk returning any `openapi-fetch` result, so it works on the endpoints this
facade wraps and on the many it does not. The page ceiling still applies and still throws,
so a truncated stream can never be mistaken for a complete one.

## Options

```ts
const client = new EcosystemsClient({
  userAgent: "my-app/1.0",       // required
  from: "you@example.com",       // From header - see Rate limits below
  apiKey: "your-api-key",        // Authorization: Bearer
  batchSize: 50,                 // PURLs per bulk lookup request (max 100)
  timeoutMs: 30_000,             // deadline per HTTP request, including its retries
  maxPages: 20,                  // page ceiling for any one paginating call
  retry: { attempts: 3 },        // or `false` to disable
  fetch: myFetch,                // custom fetch (proxies, agents, tests)
  servers: {                     // per-service base URL overrides
    packages: "https://custom.packages.server",
  },
});
```

Every method takes an optional trailing `{ signal }` for cancellation — the analogue of
Go's `context.Context`.

```ts
const controller = new AbortController();
const pkg = await client.lookup("pkg:gem/rake", { signal: controller.signal });
```

`timeoutMs` covers one HTTP request and its retries, so every bulk batch and every
followed page gets its own budget. For a deadline over a whole operation — 50 batches of
a large `bulkLookup`, say — pass your own signal, which is what a Go caller does with
`context.WithTimeout`:

```ts
await client.bulkLookup(purls, { signal: AbortSignal.timeout(120_000) });
```

## Rate limits

ecosyste.ms runs two pools. Identifying yourself triples your quota:

```ts
new EcosystemsClient({ userAgent: "my-app/1.0", from: "you@example.com" });
```

Passing `from` appends `(mailto:you@example.com)` to your User-Agent and sets the `From`
header. The User-Agent is what does the work. Measured 2026-08-16, every sample a
`cf-cache-status: MISS`:

| Identification | Tier | Limit |
| --- | --- | --- |
| nothing | `anonymous` | 5000/hr |
| `From:` header | `anonymous` | 5000/hr |
| email in the User-Agent | `polite` | 15000/hr |
| `?mailto=` query parameter | `polite` | 15000/hr |

The `From` header alone does nothing, which is worth knowing if you are porting from
ecosystems-go — that library identifies with `From` only, so it runs in the anonymous
pool. We send it anyway as the polite HTTP convention, but never rely on it.

`?mailto=` works too and is deliberately not used: the CDN sends `Vary: Origin` only, so
a query parameter gives every email its own cache entry and fragments the shared cache.
Identifying through the User-Agent costs nothing.

The most recent response's rate-limit headers are available read-only:

```ts
client.rateLimit; // { limit, remaining, reset, tier, consumer } | null
```

**Do not build control flow on these.** Responses are CDN-cached, so on a cache hit you
receive the cached response's rate-limit headers rather than your own. For real
backpressure the client already reacts to 429 and `Retry-After`.

## Beyond the wrapped methods

The facade covers the same endpoints as ecosystems-go. The generated clients are exposed
for everything else — the specs describe far more, including `/versions/lookup` (lookup by
integrity/sha256/sha1/sha512 hash), `/keywords`, `/registries/{r}/maintainers`, all of
`/topics` and `/hosts/**`, and issue/commit detail endpoints.

```ts
const { data, error, response } = await client.packages.GET("/versions/lookup", {
  params: { query: { sha256: "abc123..." } },
});
```

`client.packages`, `.repos`, `.advisories`, `.commits` and `.issues` are typed
`openapi-fetch` clients sharing the same identity, retry and rate-limit handling.

## Generated Code

`src/generated/` contains types generated from the vendored specs in `specs/`. To refresh:

```bash
npm run sync-specs   # download the latest OpenAPI specs, record sha256 in specs/.lock.json
npm run generate     # regenerate types + server URLs
```

Both the specs and the generated output are committed, and CI fails if they drift apart.
Base URLs are read from each spec's `servers[0].url` rather than hardcoded.

The generator is not a dependency of this package. `npm run generate` runs
openapi-typescript from a throwaway `npx` install, pinned to exact versions at the top of
`scripts/generate.mjs` and tracked by Renovate. It brings its own `typescript@5`, because
openapi-typescript emits through the TypeScript compiler API (`ts.factory`) and the
`typescript@7` this package compiles with no longer ships one.

## Testing

```bash
npm test                  # unit tests (loopback HTTP servers, no network)
npm run test:integration  # integration tests (hits the live API)
```

Set `ECOSYSTEMS_FROM` to run the integration suite against the polite pool.

## Differences from ecosystems-go

Deliberate, and small:

| ecosystems-go | here | why |
| --- | --- | --- |
| `nullable.Nullable[T]` wrappers | `T \| null` | native to TypeScript |
| `GetAllVersions` pages with no ceiling | capped at `maxPages`, throws | looks like an upstream oversight; every other paginating method in Go caps at 20 |
| header logic duplicated for manual pagination requests | applied once in the shared fetch | Go has a test guarding the two copies against drift; one layer makes drift impossible |
| rate-limit headers discarded | exposed as `client.rateLimit` | free information the API already sends |
| `From` header for the polite pool | email in the User-Agent | measured: `From` alone stays anonymous (see Rate limits) |
| `time.Time` | ISO 8601 `string` | no timezone assumptions baked in |
| — | `client.paginate` async iterator | no memory cliff on large result sets |
| generated clients kept private | `client.packages` … exposed | reach unwrapped endpoints without waiting for a release |

Known parity gap: bulk lookup batches run sequentially and a failed batch fails the whole
call, exactly as in Go. Bounded concurrency with partial results would be an improvement
in both, and is written up in [FOLLOWUPS.md](FOLLOWUPS.md) along with conditional
requests, the upstream spec PRs, and a rate-limit bug in ecosystems-go.

## License

MIT
