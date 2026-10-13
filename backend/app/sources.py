"""Clients for the external APIs: NASA POWER (weather), Open-Meteo (city search),
Photon (state search) and Nominatim (state outlines).

Every URL is a fixed host. User input only ever goes into the query-params
dict, so it can't redirect a request somewhere else.
"""

import asyncio

import httpx
import numpy as np
import pandas as pd
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
CITY_SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
STATE_SEARCH_URL = "https://photon.komoot.io/api/"
NOMINATIM_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "climate-hazard-analyzer/1.0 (case-study app; python-httpx)"

POWER_PARAMETERS = {"T2M_MAX": "tmax", "T2M_MIN": "tmin", "PRECTOTCORR": "precip"}
POWER_UNITS = {"T2M_MAX": "C", "T2M_MIN": "C", "PRECTOTCORR": "mm/day"}

# NASA POWER publishes no hard limits, so we stay polite with a small
# concurrency cap. Nominatim's usage policy is at most one request per second.
power_slots = asyncio.Semaphore(3)
nominatim_lock = asyncio.Lock()

http = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), headers={"User-Agent": USER_AGENT})


def is_retryable(error: BaseException) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in (429, 500, 502, 503, 504)
    return isinstance(error, httpx.TransportError)


@retry(
    retry=retry_if_exception(is_retryable),
    wait=wait_exponential(multiplier=1, max=10),
    stop=stop_after_attempt(4),
    reraise=True,
)
async def get_json(url: str, params: dict) -> dict | list:
    response = await http.get(url, params=params)
    response.raise_for_status()
    return response.json()


async def fetch_daily(lat: float, lon: float, first_year: int, last_year: int) -> pd.DataFrame:
    params = {
        "parameters": ",".join(POWER_PARAMETERS),
        "community": "AG",
        "latitude": lat,
        "longitude": lon,
        "start": f"{first_year}0101",
        "end": f"{last_year}1231",
        "format": "JSON",
    }
    async with power_slots:
        data = await get_json(POWER_URL, params)

    # Fail loudly if NASA ever changes units. Silently treating Kelvin as °C
    # would wreck every threshold.
    units = {name: meta["units"] for name, meta in data["parameters"].items()}
    if units != POWER_UNITS:
        raise ValueError(f"Unexpected NASA POWER units: {units}")

    values = data["properties"]["parameter"]
    df = pd.DataFrame({column: values[name] for name, column in POWER_PARAMETERS.items()}, dtype=float)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    return df.replace(data["header"]["fill_value"], np.nan)


async def search_cities(query: str) -> list[dict]:
    data = await get_json(CITY_SEARCH_URL, {"name": query, "count": 6, "language": "en", "format": "json"})
    return [
        {
            "id": str(place["id"]),
            "name": place["name"],
            "detail": ", ".join(filter(None, [place.get("admin1"), place.get("country")])),
            "lat": place["latitude"],
            "lon": place["longitude"],
        }
        for place in data.get("results", [])
    ]


async def nominatim(path: str, params: dict) -> list:
    async with nominatim_lock:
        data = await get_json(f"{NOMINATIM_URL}/{path}", params)
        await asyncio.sleep(1)
    return data


def parse_state(place: dict) -> dict | None:
    if place.get("geojson", {}).get("type") not in ("Polygon", "MultiPolygon"):
        return None
    south, north, west, east = map(float, place["boundingbox"])
    return {
        "id": f"{place['osm_type'][0].upper()}{place['osm_id']}",
        "name": place["name"],
        "detail": place["display_name"],
        "lat": float(place["lat"]),
        "lon": float(place["lon"]),
        "bbox": [south, west, north, east],
        "polygon": place["geojson"],
    }


async def search_states(query: str) -> list[dict]:
    """Type-ahead state search.

    Photon matches prefixes ("raja" finds Rajasthan); Nominatim only matches
    whole words, which breaks a search box that queries as you type. Photon
    returns no outline, so results carry just the OSM id; the outline is
    fetched from Nominatim by that id when the state is analysed.
    """
    data = await get_json(STATE_SEARCH_URL, {"q": query, "layer": "state", "limit": 6, "lang": "en"})
    states = []
    for feature in data.get("features", []):
        place = feature["properties"]
        west, north, east, south = place["extent"]
        lon, lat = feature["geometry"]["coordinates"]
        states.append(
            {
                "id": f"{place['osm_type']}{place['osm_id']}",
                "name": place["name"],
                "detail": place.get("country", ""),
                "lat": lat,
                "lon": lon,
                "bbox": [south, west, north, east],
            }
        )
    return states


# polygon_threshold simplifies outlines to ~5 km, plenty for picking sample
# points, and keeps responses small.
LOOKUP_PARAMS = {"format": "jsonv2", "polygon_geojson": 1, "polygon_threshold": 0.05, "accept-language": "en"}


async def lookup_state(state_id: str) -> dict | None:
    results = await nominatim("lookup", {"osm_ids": state_id, **LOOKUP_PARAMS})
    return parse_state(results[0]) if results else None
