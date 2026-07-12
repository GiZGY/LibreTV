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

## Validation

Run after each extraction:

```bash
node --check js/app.js
npm run smoke:streaming
npm run build:css
```
