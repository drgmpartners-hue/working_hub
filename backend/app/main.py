"""FastAPI application with authentication."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import auth, users, brand, ai_settings, upload, crawling, commission, content, portfolio, stock
from app.api.v1 import clients as clients_router
from app.api.v1 import snapshots as snapshots_router

app = FastAPI(title="API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(brand.router, prefix="/api/v1")
app.include_router(upload.router, prefix="/api/v1")
app.include_router(crawling.router, prefix="/api/v1")
app.include_router(ai_settings.router, prefix="/api/v1")
app.include_router(commission.router, prefix="/api/v1")
app.include_router(content.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(stock.router, prefix="/api/v1")
app.include_router(clients_router.router, prefix="/api/v1")
app.include_router(snapshots_router.router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
