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

# Debug: print DATABASE_URL format, then run migrations and start server
CMD echo "DATABASE_URL starts with: $(echo $DATABASE_URL | head -c 30)..." && \
    alembic upgrade head && \
    uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
