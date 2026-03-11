FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Debug: show all env vars related to database, then run migrations and start
CMD echo "=== DEBUG ENV ===" && \
    echo "DATABASE_URL=[${DATABASE_URL}]" && \
    echo "PORT=[${PORT}]" && \
    echo "SECRET_KEY exists: $([ -n \"$SECRET_KEY\" ] && echo yes || echo no)" && \
    env | grep -i postgres | sed 's/:[^@]*@/:***@/g' && \
    echo "=== END DEBUG ===" && \
    alembic upgrade head && \
    uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
