# --- frontend build ---
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# --- backend runtime ---
FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# DATABASE_URL points at /data so a Railway (or any) volume mounted there
# survives redeploys; the directory is created for volume-less runs too.
RUN mkdir -p /data
ENV DATABASE_URL="sqlite:////data/weather.db"

EXPOSE 8000
# Railway routes to the app's port; it injects PORT, default 8000 elsewhere.
CMD ["sh", "-c", ".venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
