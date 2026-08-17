import { describe, expect, it } from "vitest";

import { EcosystemsClient } from "../../src/client.js";
import { parsePurl } from "../../src/purl.js";

/**
 * Hits the live ecosyste.ms API. Excluded from the default suite -- run with
 * `npm run test:integration`.
 *
 * Assertions target facts that are stable but would still catch a real contract change:
 * rake and lodash exist, rake 13.0.0 exists, rubygems.org is a registry. Ported from
 * ecosystems-go's integration_test.go.
 *
 * Set ECOSYSTEMS_FROM to your email to run against the polite pool.
 */
const client = new EcosystemsClient({
  userAgent: "ecosystems-ts-test/1.0",
  from: process.env["ECOSYSTEMS_FROM"],
});

describe("live API", () => {
  it("bulk looks up packages by purl", async () => {
    const results = await client.bulkLookup([
      "pkg:gem/rails",
      "pkg:npm/lodash",
      "pkg:pypi/requests",
    ]);

    expect(results.size).toBeGreaterThan(0);

    const rails = results.get("pkg:gem/rails");
    expect(rails?.name).toBe("rails");
    // Ecosystem is "rubygems"; the registry is "rubygems.org".
    expect(rails?.ecosystem).toBe("rubygems");
  });

  it("looks up a single package", async () => {
    const pkg = await client.lookup("pkg:gem/rake");
    expect(pkg?.name).toBe("rake");
  });

  it("gets a specific version", async () => {
    const version = await client.getVersion("rubygems.org", "rake", "13.0.0");
    expect(version?.number).toBe("13.0.0");
  });

  it("gets all versions", async () => {
    const versions = await client.getAllVersions("rubygems.org", "rake");
    expect(versions.length).toBeGreaterThan(10);
  });

  it("looks up a package via a parsed PURL", async () => {
    const pkg = await client.lookupPurl(parsePurl("pkg:npm/lodash"));
    expect(pkg?.name).toBe("lodash");
  });

  it("gets a version via a parsed PURL", async () => {
    const version = await client.getVersionPurl(parsePurl("pkg:npm/lodash@4.17.21"));
    expect(version?.number).toBe("4.17.21");
  });

  it("lists registries", async () => {
    const registries = await client.listRegistries();
    expect(registries.length).toBeGreaterThan(0);
    expect(registries.map((r) => r.name)).toContain("rubygems.org");
  });

  it("looks up a repository", async () => {
    const repo = await client.getRepository("https://github.com/rails/rails");
    expect(repo?.full_name).toBe("rails/rails");
  });

  it("returns null for a repository that does not exist", async () => {
    const repo = await client.getRepository(
      "https://github.com/nope/nope-nope-xyz-does-not-exist",
    );
    expect(repo).toBeNull();
  });

  it("surfaces rate-limit headers", async () => {
    await client.listRegistries();
    expect(client.rateLimit?.limit).toBeGreaterThan(0);
  });

  // The four services below have unit tests against loopback servers but had never been
  // exercised against production, so a spec-versus-reality mismatch would not have shown
  // up. rails/rails is the fixture throughout: large, stable, and present everywhere.
  it("looks up packages by purl", async () => {
    const found = await client.lookupPackagesByPurl("pkg:gem/rails");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.purl.startsWith("pkg:gem/rails"))).toBe(true);
  });

  it("looks up packages published from a repository", async () => {
    const found = await client.lookupPackagesByRepositoryUrl(
      "https://github.com/rails/rails",
      5,
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(5);
  });

  it("gets dependent packages", async () => {
    const dependents = await client.getDependentPackages("rubygems.org", "rack", 5);
    expect(dependents.length).toBeGreaterThan(0);
    expect(dependents.length).toBeLessThanOrEqual(5);
  });

  it("gets advisories for a repository", async () => {
    const advisories = await client.getAdvisoriesByRepoUrl("https://github.com/rails/rails", 5);
    // Rails has a long CVE history; an empty list here means the endpoint changed shape.
    expect(advisories.length).toBeGreaterThan(0);
    expect(advisories[0]?.uuid).toBeTypeOf("string");
  });

  it("gets a commits summary", async () => {
    const summary = await client.getCommitsSummary("https://github.com/rails/rails");
    expect(summary?.full_name).toBe("rails/rails");
    expect(summary?.total_commits).toBeGreaterThan(0);
  });

  it("gets an issues summary", async () => {
    const summary = await client.getIssuesSummary("https://github.com/rails/rails");
    expect(summary?.full_name).toBe("rails/rails");
  });

  it("streams pages through paginate", async () => {
    const pages: number[] = [];
    for await (const page of client.paginate(() =>
      client.packages.GET("/registries/{registryName}/packages/{packageName}/versions", {
        params: {
          path: { registryName: "rubygems.org", packageName: "rake" },
          query: { per_page: 10 },
        },
      }),
    )) {
      pages.push(page.length);
      if (pages.length === 2) break;
    }

    expect(pages.length).toBe(2);
    expect(pages[0]).toBe(10);
  });
});
