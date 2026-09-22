# New UI local integration acceptance

Date: 2026-09-22. Local only; not production approval.

## Entry points

`node scripts/serve-new-ui.mjs` serves the sibling `OpenStream-UI` design and the existing API handlers on loopback port 18441. Port 18440 remains the isolated mock preview. No old UI scripts or styles are loaded by the live entry.

The Vercel build configuration is deliberately unchanged pending user approval. A future release must bring the approved UI into the tracked deployment input and switch the build atomically. Do not deploy the current legacy build as if it contained this UI.

## Evidence

- Existing `npm run smoke:all`: passed.
- Five new UI unit tests: passed (filter updates, independent playback flags, episode bounds, adult/netdisk exclusion, internal media URL rejection).
- New local-server smoke: authentication compatibility, bridge boundary, secret-file denial, new-only entry and private proxy address denial passed.
- Public access policy smoke: catalogue completeness, allowed paths, cross-site rejection and per-instance backpressure passed.
- New UI scripts passed esbuild transformation targeting ES2020.
- Real upstream sampling: Douban recommendations returned 3 items; BFZY returned 9 search results; Jisu returned 3. A limited 3-source streaming run returned 12 raw results / 11 grouped results in about 2.1 seconds. One source failed with 502 without blocking the others.
- Real CMS detail parsed playback lines; a selected media URL returned HTTP 200 and an EXT M3U playlist.
- Browser on new UI: searched Interstellar, opened real details, displayed multiple source lines and played video. Observed currentTime 9.10s, readyState 4 and finite duration 10266.97s. Paused afterward.
- Browser refresh restored 9 seconds of progress and favorite state. History showed the actual time and position.
- Mobile viewport 390px: speed increment 1 to 1.05 retained panel x=92 and width=250; primary controls remained visible.
- Douban discovery initially returned 20 results for 2024, then upstream returned an IP-limiting/login response. The UI preserves filters and identifies this as an upstream limitation, not an empty result. Repeat requests receive a local cooldown.

## Remaining release gates

- No full-length or all-source playback/ad-free guarantee. HLS fingerprint guard preserves original playlists and only skips known verified media; native HLS has a different capability boundary.
- No real iPhone/iPad hardware or AirPlay device acceptance.
- TV bridge route is preserved, but real bridge availability is external and not certified by this migration.
- Public Vercel deployment needs platform-wide request/budget protection; in-memory instance limits are not global limits.
- Legacy password environments retain compatibility; remove the old PASSWORD value when switching a deployment to public mode. No new password is required.
- Final production packaging, user visual approval and deployment are intentionally pending.

## Rollback

Stop the loopback new-UI process to return to the standalone mock preview. No production configuration or environment variable was changed. Preserve the pre-existing source-catalog and compiled changes separately from this work.
