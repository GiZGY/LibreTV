# OpenStream verification and domain cutover

Status: local candidate only. No DNS, redirect, Vercel environment or production deployment changes have been made.

## Cloudflare widget

An OpenStream Managed widget was created with approval for only `tv.cursyn.com` and `tv.cursorflow.top`. Pre-clearance is disabled. Its credentials are stored in ignored `.env.turnstile.local` with owner-only permissions, not loaded by the ordinary localhost preview. Do not add this file to Git or print its contents.

Required deployment environment keys: `TURNSTILE_ENABLED=true`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SESSION_SECRET` (random, at least 32 characters), and `TURNSTILE_HOSTNAMES=tv.cursyn.com,tv.cursorflow.top`.

Incomplete enabled configuration denies protected requests. Siteverify must report success with the configured hostname and action `browse`; frontend success alone does not authorize requests. Successful verification sets a six-hour signed HttpOnly SameSite cookie (Secure on Vercel), bound to the browser user-agent. Logout clears it. Existing password auth, if enabled, remains separate.

The proxy, TV bridge and TMDB endpoints check the cookie before upstream requests. Tokens are single-use at Cloudflare, not locally accepted strings. Verification attempts are bounded to 10/minute per trusted client IP in each process; public API requests retain 240/minute backpressure. TMDB requests retain three concurrent upstream requests, cache coalescing and cooldown.

Authenticated responses must not be served from a shared public cache: these routes use private browser caching and explicitly disable Vercel CDN caching while verification is enabled. Server-side catalog cache remains active. Purge any previously public API cache during activation, including any external Cloudflare Cache Everything rules. Never challenge individual HLS segments.

## Edge protections still required before launch

Turnstile is not volumetric DDoS protection, and process-local limits are not distributed quotas. Configure scoped Cloudflare/Vercel edge rules and verify them before launch. Apply rules only to the OpenStream host, not the parent zone's other products. Protect both verification and expensive API routes; return 429 rather than HTML challenges to XHR/JSON requests. Keep static assets and direct video traffic separate. Tune limits from measured search fan-out and normal traffic, not arbitrary single-request thresholds.

The default Vercel domain can bypass Cloudflare-only edge rules. Set equivalent Vercel Firewall protection or restrict origin access through a verified edge mechanism; do not trust client-supplied CF/IP headers. This gate does not claim those platform settings are already active.

If CSP is set at deployment, allow `https://challenges.cloudflare.com` for scripts and frames without adding unsafe-eval. Cloudflare docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/reference/content-security-policy/.

## Cutover order

1. Verify the target Vercel project and deploy the approved new UI there; configure production secrets without exposing them to frontend bundles.
2. Add `tv.cursyn.com` to that project and configure the specific DNS record using Vercel's returned target. Verify TLS, access, verification, source search and playback on the new domain first.
3. Only after acceptance, redirect the exact hostname `tv.cursorflow.top` to `https://tv.cursyn.com`, preserving path and query. Start with 302 during acceptance; use 301 once stable. Do not create a parent-domain-wide redirect. Hash routes are browser-side: verify preservation on real detail/player URLs.
4. Favorites/history in localStorage are origin-specific and do not automatically migrate with a redirect. Decide and test an explicit migration flow before retiring the old origin; never pass credentials/history in redirect query parameters.
5. Rollback: disable the old-host redirect and retain its prior DNS/deployment until acceptance completes. Rotate the session signing secret to revoke verification cookies if needed; do not silently disable the verification gate on failure.

## Local evidence

Run from the TV workspace: `node --test LibreTV/scripts/test-human-access.mjs LibreTV/scripts/test-tmdb-catalog.mjs OpenStream-UI/tests/*.test.mjs`.

Tests cover missing configuration, tampered/expired/cross-agent cookies, upstream-not-called before verification, hostname/action mismatch, foreign Origin, verification limits, failure without session issuance, and catalog metadata/related-title behavior. Official dummy keys may be used only on a separate localhost test process; a dummy action must not bypass the production `browse` action check. Production hostname validation and edge policy are separate release gates, not proven by unit tests.

Local acceptance: 33 tests passed; public-access, proxy and auth smoke checks passed. The IAB browser showed distinct TMDB recommendations for The Wild Robot and Deadpool & Wolverine, with actual year/genre labels. The isolated official-dummy-key browser test reached the safety dialog, reported a verification error, and canceled back to a usable retry state; it does not prove a successful production challenge. Its port 18442 process and browser tab were closed. Normal preview remains on 18441 without production Turnstile enabled because the widget intentionally excludes localhost.
