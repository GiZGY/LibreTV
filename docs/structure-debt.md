# Structure Debt Register

## `js/app.js`

- Current lines: 2017
- Status: controlled exception
- Reason: legacy page controller still contains API settings, modal logic, quality testing, search settings, and source management in one file.
- This change already extracted the search UI and streaming search entry into `js/search-ui.js`.

## Exit Plan

1. Extract API source settings and custom source CRUD into `js/source-settings.js`.
2. Extract quality testing and source selection into `js/source-quality-ui.js`.
3. Extract modal/detail rendering into `js/detail-modal.js`.
4. Keep `js/app.js` as a small bootstrap/controller file under 600 lines.

## `js/player.js`

- Current lines: 1714
- Status: controlled exception
- Reason: legacy player controller still contains player initialization, HLS recovery, keyboard shortcuts, episode rendering, history persistence, and resource bar rendering in one file.
- This change kept new resource-switch behavior in `js/player-resource-switch.js` and only added minimal hooks for automatic fallback.

## Player Exit Plan

1. Extract playback error handling and fallback orchestration into `js/player-fallback.js`.
2. Extract keyboard and long-press speed controls into `js/player-shortcuts.js`.
3. Extract episode list rendering and navigation into `js/player-episodes.js`.
4. Keep `js/player.js` focused on Artplayer/HLS bootstrapping under 600 lines.

## Validation

Run after each extraction:

```bash
node --check js/app.js
node --check js/player.js
npm run smoke:streaming
npm run build:css
```
