# Chaya: FastAPI + digital twin + web app. Railway builds this image; Postgres comes from the Railway Postgres service.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/tmp/numba
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Seeds the database on first boot (no-op afterwards), then serves the API and the web app.
CMD ["sh", "-c", "python scripts/seed_db.py && uvicorn api.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
