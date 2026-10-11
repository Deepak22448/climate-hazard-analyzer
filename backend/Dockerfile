FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
# --proxy-headers makes the rate limiter see the real client IP behind Render's
# proxy. Trusting every forwarder is safe only because Render's proxy is the
# sole way in; drop it if the container is ever exposed directly.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
