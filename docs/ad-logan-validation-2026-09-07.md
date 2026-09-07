# Logan ad playback validation

## Diagnosis

The production 1.1.3 settings had known-ad skipping enabled. The selected iKun
stream for Logan had an attached HLS guard but zero matching candidates from
the three published rules. This was missing coverage, not an off switch.
The earlier audit reported iKun as a network failure; that was not evidence
of ad-free playback or working ad removal.

The retrieved iKun VOD playlist contains 4,167 fragments, 223 continuity
blocks, and eight occurrences of the same six-fragment sequence. Its duration
is 17.64 seconds. One-second samples throughout the complete sequence show
gambling promotion. The new rule records all six SHA-256 fingerprints, with
expiry on 2026-10-07. It contains no media URLs. Repeated URLs alone never
authorize a skip: every occurrence still requires runtime byte verification.

## Evidence

- iKun playlist SHA-256: `7d77bbe43082e8b958681e46264c85631bbe83dffdd4b14d4c8c87d19c330345`.
- The Modu first candidate matched all 9 existing rule fingerprints.
- The Baofeng first candidate matched all 9 existing rule fingerprints.
- The 360 manifest matched the existing duration sequence; its bytes and
  playback were not verified in this investigation.
- In a dedicated Chrome production-origin tab, the new rule was temporarily
  added in memory. A fresh media load skipped the first iKun occurrence to
  192.264617 seconds and continued playing beyond 202 seconds.
- An unbuffered later occurrence skipped to 3338.904495 seconds and continued
  beyond 3349 seconds. The duration remained 8400.399 seconds in both tests.
- The eighth occurrence skipped to 5790.40524 seconds and playback continued
  beyond 5833 seconds, still with the same duration. The temporary tab was
  closed after verification, removing all runtime test injections.
- Test-time seeking and runtime rule injection are not a production release.
  The production files were not changed by these browser checks.

HLS adjusts fragment coordinates after decoding, so manifest positions are not
literal seek targets. The guard continues to use HLS coordinates, validate the
complete block, and preserve all original fragments and discontinuities.

## Regression checks

`npm run smoke:ad-guard`, `npm run smoke:player-loader`,
`npm run smoke:player-lifecycle`, and `npm run build` passed locally.
Coverage includes complete fingerprint matching, missing-part refusal,
unknown-content preservation, unchanged duration, undo, disposal, and bounded
observer requests. The guard now exposes count-only `getStatus()` diagnostics;
zero candidates must not be described as no advertisements.

## Limits

This confirms one previously uncovered iKun creative, not every creative on
every source. Embedded overlays, different encodings, new creatives, expired
rules, and native/remote playback need separate evidence. No broadening of
discontinuity-based deletion or duration-only classification is included.

## Expanded source audit

A subsequent bounded audit checked all 20 ordinary built-in sources for the
same exact title. Twelve sources returned 14 media playlists. Five source
requests failed, two were denied, and Guazi's media request was denied.
The separately verified iKun stream above is not counted as a success in this
direct-network batch. Failure is not evidence of ad-free content.

Six additional complete sequences were sampled and visually reviewed at
one-second intervals throughout their duration. Every sample shows gambling
promotion. These become rules 20260907-02 through 20260907-07:

| Source | First fragment SN | Rule suffix | Browser skip target (seconds) | Original and post-skip duration (seconds) |
|---|---:|---|---:|---:|
| dyttzy | 104 | 02 | 436.416072 | 8313.000226 |
| dyttzy | 379 | 03 | 1532.771147 | 8313.000226 |
| ffzy | 89 | 04 | 376.813722 | 8317.304873 |
| ffzy | 424 | 05 | 1716.617921 | 8317.304873 |
| iqiyi | 395 | 06 | 4135.582177 | 8282.704282 |
| lzi | 73 | 07 | 322.653246 | 8321.386000 |

All six browser cases passed complete-byte verification, automatic seeking,
and continued playback beyond the skip target. This used the repository's HLS
library, fragment loader, rules and guard in a temporary localhost harness.
The full original media manifests and bytes were relayed through a bounded,
fixed-source loopback server; only media URLs were rewritten. This is not
Vercel/LA production playback acceptance or a complete viewing of every film.
The browser tab and temporary server were stopped after testing.

An independent, bounded full-fingerprint pass matched all 16 discovered
occurrences on the first dyttzy, ffzy, iqiyi, lzi and Jianpian lines (4, 4,
1, 3 and 4 respectively). Jianpian reuses both dyttzy sequences in this sample.
It also verified one 360 occurrence against existing rule 20260906-03; the
remaining 360 occurrences were not downloaded after the traffic cap was
reached. These are byte checks, not additional browser playback cases.

The new samples expose an audit blind spot: a single insertion or rotated
fragment URLs produce zero URL-repeat candidates despite containing ads.
The audit now separately reports bounded short-block review candidates and
their total count, explicitly retaining an unverified status. It does not
classify short blocks as ads or change the player's removal criteria.

Known limits remain: untagged embedded overlays, unretrieved sources,
alternative renditions, unreviewed short blocks, and future creative changes
are not covered by this batch. No production release occurred.
