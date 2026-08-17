// The five ecosyste.ms services this SDK wraps.
//
// NOTE that we use the raw GitHub URLs instead of the live, served, OpenAPI docs to
// avoid rate limits. See also: https://github.com/ecosyste-ms/packages/issues/1735
//
// This mirrors `vendir.yml` in ecosyste-ms/ecosystems-go. Adding a service should be a
// one-line change here plus a service entry in src/servers -- see README "Adding a service".
export const SPECS = [
  { name: "packages", repo: "ecosyste-ms/packages" },
  { name: "repos", repo: "ecosyste-ms/repos" },
  { name: "advisories", repo: "ecosyste-ms/advisories" },
  { name: "commits", repo: "ecosyste-ms/commits" },
  { name: "issues", repo: "ecosyste-ms/issues" },
].map((s) => ({
  ...s,
  url: `https://raw.githubusercontent.com/${s.repo}/main/openapi/api/v1/openapi.yaml`,
}));
