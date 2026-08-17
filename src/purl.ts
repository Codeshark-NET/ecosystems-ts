import { PackageURL } from "packageurl-js";

/**
 * Maps PURL types to ecosyste.ms registry *names*.
 *
 * The API speaks two vocabularies: bulk lookup takes PURLs, but the per-package
 * endpoints are `/registries/{registry}/packages/{name}` -- and a registry name is not a
 * PURL type. This table bridges them, copied from ecosystems-go's `purlTypeToRegistry`.
 *
 * Empty string means "known PURL type, no ecosyste.ms registry" -- kept rather than
 * omitted so the gap is documented rather than merely absent. Use {@link purlToRegistry},
 * which normalises those to `null`.
 *
 * Some entries are educated guesses that will rot (`apk` pins a specific Alpine branch;
 * `deb` and `golang` are approximations). `GET /registries` returns the authoritative
 * list -- 109 entries as of 2026-08-16 -- so prefer {@link EcosystemsClient.listRegistries}
 * when correctness matters more than avoiding a round-trip.
 */
export const PURL_TYPE_TO_REGISTRY: Readonly<Record<string, string>> = {
  alpm: "archlinux.org",
  apk: "alpine-edge",
  bitbucket: "",
  bitnami: "",
  bower: "bower.io",
  brew: "formulae.brew.sh",
  cargo: "crates.io",
  carthage: "carthage",
  chef: "supermarket.chef.io",
  chocolatey: "chocolatey.org",
  clojars: "clojars.org",
  cocoapods: "cocoapods.org",
  composer: "packagist.org",
  conan: "conan.io",
  conda: "anaconda.org",
  cpan: "metacpan.org",
  cran: "cran.r-project.org",
  deb: "debian",
  docker: "hub.docker.com",
  elm: "package.elm-lang.org",
  gem: "rubygems.org",
  generic: "",
  github: "",
  golang: "proxy.golang.org",
  hackage: "hackage.haskell.org",
  hex: "hex.pm",
  huggingface: "",
  julia: "juliahub.com",
  maven: "repo1.maven.org",
  npm: "npmjs.org",
  nuget: "nuget.org",
  oci: "",
  pub: "pub.dev",
  puppet: "forge.puppet.com",
  pypi: "pypi.org",
  rpm: "",
  swift: "swiftpackageindex.com",
};

/**
 * The ecosyste.ms registry name for a PURL, or null when the type has no registry.
 *
 * `Object.hasOwn` rather than a bare lookup: `constructor` is a valid PURL type per the
 * spec's grammar, and a plain index would return `Object` itself -- truthy, typed
 * `string`, and interpolated straight into a URL path.
 */
export function purlToRegistry(purl: PackageURL): string | null {
  if (!Object.hasOwn(PURL_TYPE_TO_REGISTRY, purl.type)) return null;
  return PURL_TYPE_TO_REGISTRY[purl.type] || null;
}

/**
 * Assembles the ecosyste.ms package name from a PURL's namespace and name.
 *
 * The per-ecosystem rules are empirical, not derivable from any spec: Maven joins with a
 * colon, APK discards the namespace entirely, everything else joins with a slash.
 */
export function purlToName(purl: PackageURL): string {
  const { namespace, name, type } = purl;
  if (!namespace) return name;

  switch (type) {
    case "maven":
      // Maven uses colon separator for group:artifact
      return `${namespace}:${name}`;
    case "apk":
      // APK packages ignore namespace
      return name;
    default:
      // Most ecosystems use slash separator
      return `${namespace}/${name}`;
  }
}

/** Parses a PURL string, tolerating a missing `pkg:` scheme (`gem/rails@7.0.0`). */
export function parsePurl(value: string): PackageURL {
  return PackageURL.fromString(value.startsWith("pkg:") ? value : `pkg:${value}`);
}

/** PURL types that have an ecosyste.ms registry mapping. */
export function supportedPurlTypes(): string[] {
  return Object.entries(PURL_TYPE_TO_REGISTRY)
    .filter(([, registry]) => registry !== "")
    .map(([type]) => type);
}

export { PackageURL };
