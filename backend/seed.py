"""Download the demo cities ahead of time so the deployed app answers them instantly.

Run with: MONGO_URI="mongodb+srv://..." uv run python seed.py
"""

import asyncio

from app import store
from app.analysis import daily_for_cell, snap

DEMO_CITIES = {
    "New Delhi": (28.61, 77.21),
    "Mumbai": (19.07, 72.88),
    "Moscow": (55.75, 37.62),
    "Paris": (48.86, 2.35),
    "Chicago": (41.88, -87.63),
    "Phoenix": (33.45, -112.07),
}


async def main() -> None:
    await store.create_indexes()
    # One city at a time keeps us polite to NASA POWER.
    for name, (lat, lon) in DEMO_CITIES.items():
        daily = await daily_for_cell(*snap(lat, lon))
        print(f"{name}: {len(daily)} days cached")


if __name__ == "__main__":
    asyncio.run(main())
