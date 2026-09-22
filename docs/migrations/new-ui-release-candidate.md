# New UI release candidate

Status: NOT deployed. Vercel CLI credentials returned invalidToken on 2026-09-22. Production environment and domain bindings still require verification.

The approved UI is copied into `web/` as the tracked release input. `npm run build:new-ui` builds only the new UI and explicitly selected shared runtime files into `public/`. Vercel now selects this build; the legacy build remains available for legacy regression checks. Source scripts and CSS receive a content-derived query version and revalidation headers. No environment files, QA mute injection or native-forcing test overrides are copied.

Run `npm run quality:new-ui` for candidate checks. Run `npm run build && npm run smoke:all` for legacy/shared compatibility, then rebuild the new UI before deployment.

Before release: verify production TMDB credentials, Turnstile configuration, current domain bindings and prior successful deployment; deploy a preview and accept live catalog, search, detail and playback before promoting. Do not claim local checks as production acceptance. Existing GitHub production deployment was associated with commit 55092c34ef216b10cc189ddb19b2d18131fc1222 when inspected. Record the actual Vercel deployment URL before promotion for rollback.

Local user previews 18441 and 18447 remain available and must not be stopped during release work. The sibling OpenStream-UI remains the active local design copy for now; sync explicitly to web before subsequent releases until that duplicate source is retired.

## Git baseline preparation

`web/` is now the canonical tracked UI. Local preview and native-player smoke scripts read it directly; the external sibling is retained as a prior design copy, not a deployment input. CI adds the new UI build and native-ad contract checks. Do not merge the release PR until production environment configuration has been inspected, since merging main may trigger an automatic Vercel production deployment.
