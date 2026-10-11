# ClimaTrend frontend

React + Vite + TypeScript single-page app: pick a region and hazard, then show the backend's analysis as insights, a map and charts.

**Stack:** Tailwind CSS v4, shadcn/ui (on Base UI), Chart.js via react-chartjs-2 (+ annotation plugin), Leaflet via react-leaflet, TanStack Query.

## Run

Needs Node ≥ 20.19 and the backend running (see [backend/README.md](../backend/README.md)).

```bash
npm install
npm run dev                     # http://localhost:5173
npm run build                   # type-check + production build into dist/
npm run lint && npm run format  # oxlint + prettier
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend base URL (set it on Vercel) |

## Files

| File | What's in it |
|---|---|
| `src/App.tsx` | Page layout, header and theme toggle, form state, "Analyse" |
| `src/api.ts` | API calls (TanStack Query hooks), page URL ⇄ query string |
| `src/types.ts` | Types mirroring the backend's JSON |
| `src/components/Controls.tsx` | Region tabs, hazard, years, advanced definition |
| `src/components/PlaceSearch.tsx` | City/state autocomplete |
| `src/components/RegionMap.tsx` | Leaflet map: pick a point, draw a box, analysed cells |
| `src/components/Summary.tsx` | Insights, caveats, data-quality line, CSV/PDF buttons |
| `src/components/Charts.tsx` | Headline chart, per-metric charts, daily view |
| `src/index.css` | Theme colours, dark-mode map tiles, print stylesheet |
| `src/components/ui/` | Generated shadcn/ui components (not hand-written) |

## How it works

- **The page URL is the API query.**
  - `toQueryString` and `fromQueryString` in `api.ts` convert between form state and the query string.
  - Every analysis is therefore a shareable link that reloads to exactly the same request.
- **Nothing is sent until "Analyse".** Form edits only change local state; pressing the button sets the submitted query, and that query drives the request.
- **No hazard-specific code.**
  - `/api/meta` supplies the hazard list and the settings each hazard uses.
  - Each analysis response carries its own metric labels and units, and the charts are built from them.
  - A new hazard only optionally needs a colour in `HAZARD_COLORS` (`Charts.tsx`).
- **Caching:**
  - TanStack Query caches responses within a session.
  - Requests use `cache: 'no-cache'`, so the browser never shows a stale copy after a backend change.
  - Retries are off: the backend already retries the upstream weather APIs, so a failure here is a real error.
- **Theme:**
  - An inline script in `index.html` applies the saved or system theme before React loads, so the page never flashes the wrong colours.
  - Chart.js draws on a canvas and can't read CSS variables, so `themeColors()` in `Charts.tsx` feeds it the current colours on each render.
- **PDF export** is the browser's print dialog. The print stylesheet in `index.css` keeps cards whole and shrinks charts to the page width.
