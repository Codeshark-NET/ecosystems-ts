import { EcosystemsError } from "./errors.js";

export const DEFAULT_PER_PAGE = 100;

/**
 * Hard ceiling on pages followed in one call.
 *
 * Exceeding it throws rather than truncating silently -- a silently short dependency or
 * advisory list is a correctness bug in the caller, not a smaller result. Same decision
 * as ecosystems-go.
 */
export const DEFAULT_MAX_PAGES = 20;

/**
 * Extracts the `rel="next"` URL from an RFC 8288 `Link` header.
 *
 * The `Link` header is not declared in any ecosyste.ms OpenAPI spec, yet it drives all
 * pagination. Tolerates bare `rel=next`, ignores `rel=first`/`rel=last`, allows commas
 * inside the URL, and returns null on malformed input. Direct port of Go's `nextLink`.
 */
export function nextLink(header: string | null | undefined): string | null {
  if (!header) return null;

  let rest = header;
  let open = rest.indexOf("<");

  while (open !== -1) {
    rest = rest.slice(open + 1);
    const close = rest.indexOf(">");
    if (close === -1) return null; // unterminated

    const url = rest.slice(0, close);
    const after = rest.slice(close + 1);
    const nextOpen = after.indexOf("<");
    const params = nextOpen === -1 ? after : after.slice(0, nextOpen);

    if (params.includes('rel="next"') || params.includes("rel=next")) return url;

    rest = after;
    open = nextOpen;
  }

  return null;
}

/** Shrinks `per_page` when the caller wants fewer than a full page. */
export function perPageForCap(maxItems: number): number {
  return maxItems > 0 && maxItems < DEFAULT_PER_PAGE ? maxItems : DEFAULT_PER_PAGE;
}

/** Truncates to `maxItems`; `maxItems <= 0` means unlimited. */
export function capItems<T>(items: T[], maxItems: number): { items: T[]; capped: boolean } {
  if (maxItems <= 0 || items.length <= maxItems) return { items, capped: false };
  return { items: items.slice(0, maxItems), capped: true };
}

/** True once we hold everything the caller asked for. `maxItems <= 0` is never satisfied. */
function satisfied(count: number, maxItems: number): boolean {
  return maxItems > 0 && count >= maxItems;
}

/**
 * The next page's URL, resolved against the response it came from.
 *
 * RFC 8288 permits a relative URI-reference. ecosyste.ms sends absolute URLs today
 * (checked), but a proxy rewriting them to `</api/v1/...>` would otherwise make
 * `new Request(next)` throw rather than paginate.
 */
export function nextPageUrl(response: Response): string | null {
  const next = nextLink(response.headers.get("link"));
  if (next === null || !response.url) return next;
  try {
    return new URL(next, response.url).toString();
  } catch {
    return next;
  }
}

export type PageFetcher<T> = (url: string) => Promise<{ data: T[]; response: Response }>;

export interface FollowOptions<T> {
  /** The already-fetched first page. */
  first: T[];
  /** The response that first page came from, for its `Link` header. */
  response: Response;
  /** Stop after this many items. `<= 0` means unlimited. */
  maxItems?: number;
  maxPages?: number;
  getPage: PageFetcher<T>;
}

/**
 * Follows `Link: rel="next"` from an initial response, accumulating results.
 *
 * Port of Go's `appendLinkedPages`. See `paginateLinked` for a streaming alternative that
 * avoids holding every page in memory.
 *
 * DIVERGENCE FROM ecosystems-go: Go stops only once a page overshoots `maxItems`, so a
 * request for exactly 25 items that the first page already satisfies still fetches a
 * second page and discards it -- and a 429 on that wasted page fails a call whose results
 * were already in hand. We stop as soon as the count is reached. Same results, one fewer
 * round-trip, one fewer way to fail.
 */
export async function followLinkedPages<T>(options: FollowOptions<T>): Promise<T[]> {
  const { first, response, maxItems = 0, maxPages = DEFAULT_MAX_PAGES, getPage } = options;

  let { items: out } = capItems(first, maxItems);
  if (satisfied(out.length, maxItems)) return out;

  let next = nextPageUrl(response);

  for (let page = 1; next !== null && page < maxPages; page++) {
    const result = await getPage(next);
    ({ items: out } = capItems(out.concat(result.data), maxItems));
    if (satisfied(out.length, maxItems)) return out;

    next = nextPageUrl(result.response);
  }

  if (next !== null) {
    throw new EcosystemsError(`pagination exceeded max pages ${maxPages}`, { url: next });
  }

  return out;
}

/**
 * Streaming form of {@link followLinkedPages}, yielding one page at a time.
 *
 * ecosystems-go has no equivalent -- it always accumulates into a slice. Async iteration
 * is the natural TypeScript shape and lets callers stop early without a page budget.
 */
export async function* paginateLinked<T>(
  options: Omit<FollowOptions<T>, "maxItems">,
): AsyncGenerator<T[], void, undefined> {
  const { first, response, maxPages = DEFAULT_MAX_PAGES, getPage } = options;

  yield first;
  let next = nextPageUrl(response);

  for (let page = 1; next !== null && page < maxPages; page++) {
    const result = await getPage(next);
    yield result.data;
    next = nextPageUrl(result.response);
  }

  if (next !== null) {
    throw new EcosystemsError(`pagination exceeded max pages ${maxPages}`, { url: next });
  }
}
