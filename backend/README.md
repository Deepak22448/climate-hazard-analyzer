# ClimaTrend backend

FastAPI service: validates requests, caches NASA POWER data in MongoDB, detects hazards, fits trends and returns JSON. The climate logic (thresholds, QC rules, statistics) is explained in the [root README](../README.md).

## Run

Needs Python 3.12, [uv](https://docs.astral.sh/uv/) and a MongoDB (local: `docker run -d --name climate-mongo -p 27017:27017 mongo:8`).

```bash
uv sync
uv run uvicorn app.main:app --reload          # http://localhost:8000/docs
uv run pytest                                 # hazard + trend tests
uv run ruff check . && uv run ruff format .   # lint + format
uv run python seed.py                         # optional: pre-download demo cities

docker build -t climate-api .                 # production image (used by render.yaml)
docker run -p 8000:8000 -e MONGO_URI=mongodb://host.docker.internal:27017 climate-api
```

| Variable | Default | Purpose |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowlist, comma-separated |

## Files

| File | What's in it |
|---|---|
| `app/main.py` | HTTP layer: request models and validation, rate limits, CSV export |
| `app/analysis.py` | The request flow: region → grid cells → daily data → regional result |
| `app/hazards.py` | QC and hazard detection. Pure functions, no I/O |
| `app/trends.py` | Rolling mean, regression, Mann-Kendall / Sen's slope, insight sentences |
| `app/sources.py` | NASA POWER, Open-Meteo, Photon and Nominatim clients (retry, backoff, politeness limits) |
| `app/store.py` | MongoDB collections |
| `seed.py` | Pre-downloads demo cities |
| `tests/test_hazards.py` | Synthetic-series tests: run detection, gaps, QC, trend significance |
| `Dockerfile` | Production image; uvicorn with `--proxy-headers` so rate limits see real client IPs |

## MongoDB collections

Database `climate_hazards`.

| Collection | One document | `_id` | Written when | Expires |
|---|---|---|---|---|
| `weather_daily` | One grid cell × one year: `tmax[]`, `tmin[]`, `precip[]` (raw, before QC) | `"56.0_37.5_1981"` | A request needs a cell or year not yet stored | Never |
| `analyses` | One finished analysis response (`result`) | SHA-256 of the normalised query + `ALGO_VERSION` | After a cache miss on `/api/analysis` or `.csv` | 7 days (TTL index) |
| `places` | One state: name, bbox, simplified outline polygon (from Nominatim) | OSM id, e.g. `"R1942920"` | A state is analysed for the first time | 30 days (TTL index) |
| `state_searches` | The Photon results for one typed text | Normalised text, e.g. `"raja"` | A state search not seen before | 30 days (TTL index) |

City searches are not stored: the frontend sends the city's coordinates, so there is nothing to look up again.

## API

Interactive docs at `/docs`.

| Endpoint | Purpose | Rate limit |
|---|---|---|
| `GET /api/health` | Liveness check | – |
| `GET /api/meta` | Year range, hazards, and the parameters each hazard uses | – |
| `GET /api/places?q=&kind=city\|state` | Place search | 30/min |
| `GET /api/analysis?hazard=&lat=&lon=` (or `bbox=s,w,n,e` or `state=`) `&start=&end=&percentile=&min_days=&method=` | Full analysis | 20/min |
| `GET /api/analysis.csv?…` | Same parameters; the yearly table as CSV | 20/min |
| `GET /api/daily?hazard=&lat=&lon=&year=…` | One year of daily values, threshold and events for one cell | 60/min |

## Common changes

| Change | Where |
|---|---|
| Add a hazard | One detection function plus one entry in `HAZARDS` (`hazards.py`) |
| Baseline period | `BASELINE` in `hazards.py`, then bump `ALGO_VERSION` in `analysis.py` |
| Any change to results | Bump `ALGO_VERSION` so cached analyses are recomputed |
| Default percentile / minimum days | `HazardParams` in `hazards.py` (and the frontend defaults in `App.tsx`) |
| Significance level | `SIGNIFICANCE` in `trends.py` |
| Cells per region | `MAX_POINTS` in `analysis.py` |
| Rate limits | `@limiter.limit(...)` decorators in `main.py` |
