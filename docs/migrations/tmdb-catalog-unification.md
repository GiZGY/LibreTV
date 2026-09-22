# TMDB catalogue candidate

Local-only candidate; no production deployment or Cloudflare policy changes.

Home, genre shelves, TV recommendations and Explore now request TMDB catalogue
data. Details request credits and overview independently of playback sources.
Legacy saved records retain their identities; exact title/year matches may enrich
them, while ambiguous matches keep existing metadata. Search remains source-based.

Opening details begins bounded source discovery. The play link is disabled while
checking or on failure, with retry available. Finding episode URLs is not proof of
successful media playback; the UI says sources were found, not playback verified.
This avoids probing every poster or fetching video segments while browsing.

Cache layers: browser and instance caches have a one-hour TTL. Vercel requests
also use Runtime Cache via @vercel/functions, namespace openstream-tmdb-v2.
Only normalized public catalogue data is stored, never tokens or user records.
Access verification runs before cache retrieval. With Turnstile enabled, response
CDN caching remains disabled; shared data caching is inside the verified function.
Without verification and in public mode the existing CDN policy remains available.
Runtime Cache is regional, subject to platform quotas/pricing, and does not provide
a distributed lock. Simultaneous cold misses across instances can duplicate work.
Cache failure falls back to bounded upstream requests, not authentication bypass.

Tests simulate independent service instances sharing a cache and 100 coalesced
requests. They do not prove production cache hits. Before release verify Runtime
Cache metrics, real Turnstile success/denial, upstream traffic under concurrent
clients and plan usage limits. Do not claim globally exactly one upstream request.

Rollback is a code release rollback; the new cache namespace expires after an hour
and contains no user state. No DNS changes are involved.
