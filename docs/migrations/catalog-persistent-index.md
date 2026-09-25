# Persistent catalogue index

## State and boundaries

- The index path is opt-in with `CATALOG_INDEX_ENABLED=1`. Keep it unset until a complete snapshot has been imported and accepted.
- Neon connection: `CATALOG_DATABASE_URL` (preferred), with Vercel Neon integration fallbacks `CATALOG_POSTGRES_URL_NON_POOLING` and `CATALOG_POSTGRES_URL`; server-only. Local configuration belongs in ignored `.env.catalog.local`. Never copy it into a browser bundle, log or commit.
- Only public film metadata is stored. Video streams, login credentials, playback history and user collections are not stored here.
- Detail, related films, playback-source lookup and Turnstile retain their existing endpoints and protections.
- Exact totals describe the published, policy-filtered OpenStream catalogue, not every record held by TMDB and not guaranteed playable sources.

## Import and acceptance

```sh
npm run catalog:migrate
npm run catalog:sync -- batches=1 requests=40
npm run catalog:status
```

Each invocation resumes the single draft, with a bounded request and wall-time budget. Each batch allows at most 200 upstream requests. At most four requests execute together, paced at four starts per second. Transient failures retain progress and retry at most three consecutive times with backoff (at least 60 seconds for 429); persistent failures stop explicitly. No user request starts an import.

For initial maintenance imports, `batches=10000 requests=200 minutes=360` allows at most six hours and stops earlier if complete or on error. The ignored `.catalog-sync-status.local` records progress without secrets. The process does not publish or deploy automatically. Normal invocations still default to a single batch. Do not run competing import processes.

The initial import scans movie and TV releases from 1990 to the current date, matching the Explore year options. Windows above TMDB's 500-page cap split into smaller non-overlapping date ranges. A single-day overflow fails explicitly. This initial operation is substantial; do not represent a partial import as a complete catalogue. Country information is obtained from film metadata, not inferred from title language. Regional Chinese names are checked before exclusion.

To narrow an older draft, first stop its worker, then run `node scripts/catalog-index.mjs narrow revision=1 from=1990` and resume sync. This CAS-protected operation preserves imported rows and scan progress; it refuses to change coverage if stored rows fall outside the new range. It does not delete data. A terminated batch can be replayed safely from its last checkpoint. Publishing still requires every in-range window to be complete.

Publishing is explicit:

```sh
npm run catalog:publish -- revision=REVISION_ID
```

Publishing requires complete queues, nonempty contents and full year coverage. Validate year 2005 and 2006 independently, film/TV/documentary and country filters, rating thresholds, first/middle/final pages, no duplicate IDs, and actual database query latency before enabling the flag in Vercel. Local PostgreSQL-engine fixture tests are not a substitute for Neon acceptance.

Readers see only `ready` snapshots. A browser pins its snapshot for pagination. Cached queries share canonical filter keys rather than random visitor IDs. Counts and rows execute in one SQL statement against the same revision. Unknown or unavailable snapshots return an error rather than zero results.

## Refresh, quotas and rollback

The first full import still requires explicit publication. Daily updates use `npm run catalog:refresh -- batches=10000 requests=200 minutes=120`. They clone the last ready snapshot, consume TMDB movie/TV changes plus newly released titles, and revisit one thirtieth of existing records to refresh ratings/popularity even when absent from the change feed. Detail responses include translations, so previously excluded titles can enter once their Chinese title or score changes. Removed and newly disqualified entries disappear only in the new snapshot. Readers and the previous snapshot are never modified. The current UTC day remains open; fully processed days form the next watermark. A gap over the upstream 14-day change window stops explicitly instead of silently omitting updates.

`.github/workflows/catalog-refresh.yml` schedules the bounded job daily on the public repository's GitHub-hosted runner, not inside a long-lived Vercel request. It requires repository variable `CATALOG_REFRESH_ENABLED=1` and server-only Actions secrets `CATALOG_DATABASE_URL` and `TMDB_READ_ACCESS_TOKEN`. No pull-request trigger can access these secrets. The production UI/API remains on Vercel. Keep this switch off until the initial snapshot and a real workflow run have been accepted. A budget-exhausted run retains its draft and fails visibly; the next run resumes it. Only a complete refresh publishes automatically. A manual workflow dispatch can recover without waiting for the next schedule. Do not claim the schedule is operational merely because the workflow exists.

The worker stops at 350 MiB database size, below the provisioned free 0.5 GB allowance. Snapshot creation also checks space before copying, using observed database growth plus headroom. These guards do not guarantee all provider resource limits. Monitor compute usage and workflow runtime separately. Daily refreshes retain the latest two published snapshots (active plus one rollback generation), any running draft's base, and do not remove a snapshot younger than two hours. This protects pinned pagination sessions while keeping three full generations within the observed storage budget. No daily full rescan is scheduled.

Rollback: remove `CATALOG_INDEX_ENABLED` and redeploy to use the existing catalogue path; disable `CATALOG_REFRESH_ENABLED` to stop scheduled writes. Do not delete the database. The current snapshot and one previous complete snapshot remain available; active page pins remain valid for their two-hour lifetime.

## Checks

```sh
npm run test:catalog-index
node --test scripts/test-tmdb-catalog.mjs scripts/test-filtered-catalog.mjs
npm run quality:new-ui
```

SQL tests use PGlite (the PostgreSQL engine) with disposable in-memory fixtures, not a mock SQL parser. They cover exact counts, final pages, stable snapshots, concurrent writer compare-and-swap, SQL parameter validation, cache coalescing, partial-import rejection and upstream failure recovery.
