# Local catalog request audit

Scope: new OpenStream UI only; not deployed. Existing backend proxy remains unchanged.

## Direct access evidence

A GET to the existing Douban `/j/new_search_subjects` URL with the local UI Origin returned HTTP 200, a `data` array of 20 records, no total, and no Access-Control-Allow-Origin header. A same-origin local diagnostic page attempting a CORS fetch could not read the response (TypeError: Failed to fetch). No cookies, credentials, account login, or browser security overrides were used.

The website cannot currently deliver a browser-readable direct Douban API request from each visitor's IP. Existing `/proxy/` requests originate from the application server. This patch does not disguise the proxy as direct access or add an alternate IP relay. Upstream access policies can change; repeat a bounded capability check before changing transport.

## Local improvements

- Explore query/page cache: 24 hours; recommendations: 1 hour.
- Previously successful responses retained for up to 7 days beyond expiry, shown immediately while a bounded refresh runs. No timed background polling.
- Cache max 80 responses and approximately 1.5 million serialized characters. Browser storage failure is tolerated.
- Request coalescing, serial execution, minimum 1.2 second spacing and 180ms cancellation window.
- HTTP 429 or business throttling: 60 second cooldown persisted across reload; errors are never cached as catalog pages.
- Pagination uses the upstream record count before content filtering. No invented total. A non-empty short page establishes an observed end; empty out-of-range saved pages return to a previously successful page or page one without scanning backward.
- No full catalog crawl and no speculative prefetch, to avoid increasing rate-limit pressure.

## Remaining boundary

Uncached conditions still need the existing proxy and may be throttled. Accurate global counts require a provider returning totals or an independently maintained catalog, with explicit data licensing, update policy and storage choices. A Vercel CDN is not a per-user outgoing network connection. These are not solved by local caching.

## Verification

`node --test OpenStream-UI/tests/*.test.mjs` from the TV workspace covers stale-response fallback, persistent cooldown, request coalescing, canceled queued queries and filtered pagination. Real local browser validation must be kept separate from Vercel deployment acceptance.

## TMDB local candidate (2026-09-22)

- The Explore provider switch retains Douban and adds the official TMDB discover API. TMDB ratings are labeled separately on cards, details and playback.
- Credentials are server-only in ignored `.env.local`. The fixed upstream endpoint is not an arbitrary proxy. Local preview honors HTTPS_PROXY only for TMDB transport; production transport is unchanged.
- Cache lifetime is one hour with bounded memory and coalesced requests. Public responses include Vercel CDN cache headers; actual deployed cache behavior has not been tested.
- Totals come from TMDB, not a local crawl. Browsable pages are capped at the API's 500-page limit with an explicit notice. Catalog presence does not guarantee a playable CMS source.
- Real local requests: movie and TV 2024 pages 1/2 returned 20 items each; first requests measured 305-584 ms, server cache hits 2 ms on this machine. These are observations, not production guarantees.
- Movie + 2024 + science fiction returned 79 pages; page 79 had 13 items and hasNext=false. Anime 2024 returned 36 pages; variety 2024 returned 85 pages. Page 501 correctly returned 400.
- Chrome verified poster rendering, provider switching, year/genre filters, pages 1/2/back, and TMDB rating attribution on details. The Wild Robot resolved to 10 existing playback lines and loaded duration metadata.
- Playback advanced to 00:34 with a rendered frame. The selected existing source contained embedded advertising; catalog integration does not certify source quality or ad removal. Playback was stopped by returning to Explore.
- Repeat checks: `node --test LibreTV/scripts/test-tmdb-catalog.mjs OpenStream-UI/tests/*.test.mjs` (23 passed), from the TV workspace. Preview: `cd LibreTV && node scripts/serve-new-ui.mjs`.
- Before release: finish official TMDB logo attribution, verify production credentials/CDN behavior and translation-to-source matching across a wider title sample. No deployment performed.
