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
COPY backend/pyproject.toml backend/uv.lock* ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev || uv sync --no-dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

ENV DATABASE_URL="sqlite:////app/backend/weather.db"
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
